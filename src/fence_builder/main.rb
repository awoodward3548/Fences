require 'sketchup.rb'
require 'json'

module FenceBuilder
  dir = File.dirname(__FILE__)
  dir.force_encoding('UTF-8') if dir.respond_to?(:force_encoding)
  %w[util catalog geo path_parser panel_builder post_builder bom builder manager dialog].each do |f|
    Sketchup.require(File.join(dir, f))
  end
  ICON_DIR = File.join(dir, 'icons')

  def self.icon(name)
    File.join(ICON_DIR, "#{name}.png")
  end

  def self.safely(label)
    yield
  rescue StandardError => e
    puts "Fence Builder #{label} error: #{e.message}\n#{e.backtrace.first(6).join("\n")}"
    UI.messagebox("Fence Builder: #{label} failed.\n#{e.message}")
  end

  def self.quick_create
    safely('Create') do
      made = Manager.create(Manager.last_settings)
      Dialog.push_selection
      made
    end
  end

  unless file_loaded?(__FILE__)
    cmd_open = UI::Command.new('Fence Builder...') { Dialog.show }
    cmd_open.tooltip = 'Fence Builder'
    cmd_open.status_bar_text = 'Open Fence Builder: pick a fence style and build it along a grouped line.'
    cmd_open.small_icon = icon('fence_16')
    cmd_open.large_icon = icon('fence_24')

    cmd_quick = UI::Command.new('Create Fence (last settings)') { quick_create }
    cmd_quick.tooltip = 'Create Fence from Selection'
    cmd_quick.status_bar_text = 'Build a fence on the selected line group using the last-used settings.'
    cmd_quick.small_icon = icon('create_16')
    cmd_quick.large_icon = icon('create_24')

    cmd_gate = UI::Command.new('Mark / Unmark Gate Edges') do
      safely('Mark gate') do
        Manager.mark_gates({})
        Dialog.push_selection
      end
    end
    cmd_gate.tooltip = 'Mark Gate Edges'
    cmd_gate.status_bar_text = 'Mark the selected edges of a fence line as gate openings (select again to unmark).'
    cmd_gate.small_icon = icon('gate_16')
    cmd_gate.large_icon = icon('gate_24')

    cmd_rebuild = UI::Command.new('Rebuild Selected Fences') do
      safely('Rebuild') do
        Manager.rebuild
        Dialog.push_selection
      end
    end
    cmd_rebuild.tooltip = 'Rebuild Fence from Path'
    cmd_rebuild.status_bar_text = 'Rebuild the selected fences after editing their path line.'
    cmd_rebuild.small_icon = icon('rebuild_16')
    cmd_rebuild.large_icon = icon('rebuild_24')

    cmd_bom = UI::Command.new('Export Bill of Materials...') { safely('Export') { Manager.export_bom } }
    cmd_bom.tooltip = 'Export Fence BOM (CSV)'
    cmd_bom.status_bar_text = 'Export a CSV bill of materials for the selected fences (or all fences).'
    cmd_bom.small_icon = icon('bom_16')
    cmd_bom.large_icon = icon('bom_24')

    menu = UI.menu('Extensions').add_submenu('Fence Builder')
    menu.add_item(cmd_open)
    menu.add_separator
    menu.add_item(cmd_quick)
    menu.add_item(cmd_gate)
    menu.add_item(cmd_rebuild)
    menu.add_item(cmd_bom)

    tb = UI::Toolbar.new('Fence Builder')
    [cmd_open, cmd_quick, cmd_gate, cmd_rebuild, cmd_bom].each { |c| tb.add_item(c) }
    tb.restore

    UI.add_context_menu_handler do |cm|
      sel = Sketchup.active_model.selection
      if sel.any? { |e| FenceBuilder.fence?(e) }
        sub = cm.add_submenu('Fence Builder')
        sub.add_item('Edit Fence...') { Dialog.show }
        sub.add_item('Rebuild from Path') { safely('Rebuild') { Manager.rebuild } }
        sub.add_item('Export BOM...') { safely('Export') { Manager.export_bom } }
      elsif sel.any? { |e| PathParser.path_entity?(e) }
        sub = cm.add_submenu('Fence Builder')
        sub.add_item('Create Fence Here...') { Dialog.show }
        sub.add_item('Create Fence (last settings)') { quick_create }
      elsif sel.grep(Sketchup::Edge).any?
        sub = cm.add_submenu('Fence Builder')
        sub.add_item('Mark / Unmark as Gate') { safely('Mark gate') { Manager.mark_gates({}) } }
        sub.add_item('Create Fence on Edges...') { Dialog.show }
      end
    end

    file_loaded(__FILE__)
  end
end
