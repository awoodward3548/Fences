require 'json'

module FenceBuilder
  # Model-level operations: create, update and rebuild fences, mark gates and
  # export the bill of materials. All edits are wrapped in undoable operations.
  module Manager
    GATE_LAYER = 'Fence Gate'.freeze
    module_function

    def last_file
      File.join(Catalog.user_dir, 'last_settings.json')
    end

    def model
      Sketchup.active_model
    end

    # ------------------------------------------------------------ settings

    def last_settings
      if File.exist?(last_file)
        Catalog.resolve(JSON.parse(File.read(last_file)))
      else
        Catalog.defaults(Catalog.data['lines'].first['id'])
      end
    rescue StandardError
      Catalog.defaults(Catalog.data['lines'].first['id'])
    end

    def save_last(settings)
      FileUtils.mkdir_p(Catalog.user_dir)
      File.open(last_file, 'w') { |f| f.write(JSON.generate(settings)) }
    rescue StandardError => e
      puts "Fence Builder: could not save settings (#{e.message})"
    end

    def fence_settings(fence)
      Catalog.resolve(JSON.parse(fence.get_attribute(DICT, 'settings', '{}')))
    end

    def fence_bom(fence)
      JSON.parse(fence.get_attribute(DICT, 'bom', '{}'))
    rescue StandardError
      {}
    end

    # ----------------------------------------------------------- selection

    def selected_fences
      model.selection.select { |e| FenceBuilder.fence?(e) }
    end

    def selection_info
      sel = model.selection
      fences = selected_fences
      paths = sel.select { |e| PathParser.path_entity?(e) }
      edges = sel.grep(Sketchup::Edge)
      len = 0.0
      paths.each { |p| len += PathParser.total_length(PathParser.from_entity(p)) }
      len += PathParser.total_length(PathParser.from_edges(edges)) unless edges.empty?
      gate_edges = edges.count { |e| PathParser.gate_opts(e) }
      {
        'fences' => fences.map do |f|
          { 'name' => f.name, 'settings' => fence_settings(f), 'bom' => fence_bom(f),
            'linked' => !find_path(f).nil? }
        end,
        'paths' => paths.size,
        'edges' => edges.size,
        'gate_edges' => gate_edges,
        'length' => len > 0 ? FenceBuilder.fmt_len(len) : ''
      }
    end

    # --------------------------------------------------------------- build

    def create(settings)
      s = Catalog.resolve(settings)
      sel = model.selection
      paths = sel.select { |e| PathParser.path_entity?(e) }
      edges = sel.grep(Sketchup::Edge)
      if paths.empty? && edges.empty?
        if selected_fences.any?
          return update(settings)
        end
        UI.messagebox("Select a group (or component) containing the fence line, or select loose edges,\n" \
                      'then click Create Fence.')
        return []
      end
      created = []
      model.start_operation('Create Fence', true)
      paths.each do |p|
        chains = PathParser.from_entity(p)
        next if chains.empty?
        root = parent_entities(p).add_group
        link(root, p)
        build(root, s, chains)
        created << root
      end
      unless edges.empty?
        chains = PathParser.from_edges(edges)
        unless chains.empty?
          root = model.active_entities.add_group
          build(root, s, chains)
          created << root
        end
      end
      model.commit_operation
      save_last(s)
      sel.clear
      sel.add(created) unless created.empty?
      created
    rescue StandardError
      model.abort_operation
      raise
    end

    # Apply new settings to the selected fences.
    def update(settings, fences = selected_fences)
      return [] if fences.empty?
      s = Catalog.resolve(settings)
      model.start_operation('Edit Fence', true)
      fences.each { |f| rebuild_fence(f, s) }
      model.commit_operation
      save_last(s)
      fences
    rescue StandardError
      model.abort_operation
      raise
    end

    # Rebuild selected fences from their (possibly edited) path lines.
    def rebuild(fences = selected_fences)
      return [] if fences.empty?
      model.start_operation('Rebuild Fence', true)
      fences.each { |f| rebuild_fence(f, fence_settings(f)) }
      model.commit_operation
      fences
    rescue StandardError
      model.abort_operation
      raise
    end

    def rebuild_fence(fence, s)
      path = find_path(fence)
      if path
        chains = PathParser.from_entity(path)
        fence.transformation = Geom::Transformation.new
      else
        chains = JSON.parse(fence.get_attribute(DICT, 'chains', '[]'))
      end
      build(fence, s, chains) unless chains.empty?
    end

    def build(root, s, chains)
      root.make_unique if root.respond_to?(:make_unique)
      root.entities.clear!
      bom = Builder.new(model, root, s, chains).build
      root.name = "Fence - #{Catalog.style_label(s)} #{FenceBuilder.fmt_len(FenceBuilder.num(s['height']))}"
      root.set_attribute(DICT, 'settings', JSON.generate(s))
      root.set_attribute(DICT, 'chains', JSON.generate(chains))
      root.set_attribute(DICT, 'bom', JSON.generate('rows' => bom.rows, 'summary' => bom.summary))
      root
    end

    def parent_entities(ent)
      ent.parent.entities
    end

    # ------------------------------------------------------- path linking

    def link(fence, path)
      id = path.get_attribute(DICT, 'path_id')
      unless id
        id = "#{Time.now.to_i.to_s(36)}#{rand(36**8).to_s(36)}"
        path.set_attribute(DICT, 'path_id', id)
      end
      fence.set_attribute(DICT, 'path_id', id)
    end

    def find_path(fence)
      id = fence.get_attribute(DICT, 'path_id')
      return nil unless id && fence.valid?
      fence.parent.entities.find do |e|
        (e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)) &&
          e.get_attribute(DICT, 'path_id') == id && !FenceBuilder.fence?(e)
      end
    end

    def fences_for_path(path)
      id = path.get_attribute(DICT, 'path_id')
      return [] unless id
      path.parent.entities.select { |e| FenceBuilder.fence?(e) && e.get_attribute(DICT, 'path_id') == id }
    end

    # --------------------------------------------------------------- gates

    # Marks the selected edges as gates using the given gate options. If every
    # selected edge already is a gate, they are unmarked instead.
    def mark_gates(gate_opts = {})
      edges = model.selection.grep(Sketchup::Edge)
      if edges.empty?
        UI.messagebox("Open the fence line group (double-click it), select the edge(s) where gates go,\n" \
                      "then click Mark Gate. Tip: split a long edge at the gate first by drawing\n" \
                      'a short line across it, or use the Tape Measure to place guide points.')
        return 0
      end
      unmark = edges.all? { |e| PathParser.gate_opts(e) } && gate_opts.empty?
      model.start_operation(unmark ? 'Unmark Gate' : 'Mark Gate', true)
      layer = gate_layer
      edges.each do |e|
        if unmark
          e.delete_attribute(DICT)
          e.layer = model.layers[0] if e.layer == layer
        else
          e.set_attribute(DICT, 'gate', true)
          gate_opts.each { |k, v| e.set_attribute(DICT, k, v) if k.to_s.start_with?('gate_') }
          e.layer = layer
        end
      end
      refresh_linked(edges.first.parent)
      model.commit_operation
      edges.size
    rescue StandardError
      model.abort_operation
      raise
    end

    def unmark_gates
      edges = model.selection.grep(Sketchup::Edge)
      return 0 if edges.empty?
      model.start_operation('Unmark Gate', true)
      edges.each do |e|
        e.delete_attribute(DICT)
        e.layer = model.layers[0] if e.layer.name == GATE_LAYER
      end
      refresh_linked(edges.first.parent)
      model.commit_operation
      edges.size
    end

    def gate_layer
      layer = model.layers[GATE_LAYER] || model.layers.add(GATE_LAYER)
      layer.color = Sketchup::Color.new(255, 120, 0) if layer.respond_to?(:color=)
      layer
    end

    # Rebuild fences whose path definition contains the edited edges.
    def refresh_linked(parent)
      return unless parent.is_a?(Sketchup::ComponentDefinition)
      parent.instances.each do |inst|
        fences_for_path(inst).each { |f| rebuild_fence(f, fence_settings(f)) }
      end
    end

    # ----------------------------------------------------------------- BOM

    def all_fences(ents = model.entities, out = [])
      ents.each do |e|
        if FenceBuilder.fence?(e)
          out << e
        elsif e.is_a?(Sketchup::Group)
          all_fences(e.entities, out)
        end
      end
      out
    end

    def export_bom
      fences = selected_fences
      fences = all_fences if fences.empty?
      if fences.empty?
        UI.messagebox('There are no fences in this model yet.')
        return
      end
      path = UI.savepanel('Save Fence Bill of Materials', nil, 'Fence BOM.csv')
      return unless path
      path += '.csv' unless path.downcase.end_with?('.csv')
      File.open(path, 'w') do |f|
        f.puts(csv_row(%w[Fence Category Item Qty Unit Notes]))
        fences.each do |fence|
          (fence_bom(fence)['rows'] || []).each do |r|
            f.puts(csv_row([fence.name, r['cat'], r['item'], r['qty'], r['unit'], r['note']]))
          end
        end
      end
      UI.messagebox("Bill of materials saved to:\n#{path}")
      path
    end

    def csv_row(vals)
      vals.map do |v|
        s = v.to_s
        s =~ /[",\n]/ ? "\"#{s.gsub('"', '""')}\"" : s
      end.join(',')
    end
  end
end
