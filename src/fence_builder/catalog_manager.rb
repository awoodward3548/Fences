require 'json'

module FenceBuilder
  # The Catalog Manager window: add and edit product lines, styles, colors and
  # photos. Edits are saved to the user catalog (see Catalog.user_file).
  module CatalogManager
    HTML = File.join(File.dirname(__FILE__), 'html', 'catalog.html')

    module_function

    def show
      if @dlg && @dlg.visible?
        @dlg.bring_to_front
        return
      end
      @dlg = UI::HtmlDialog.new(
        dialog_title: 'Fence Builder - Catalog Manager',
        preferences_key: 'FenceBuilder.CatalogManager',
        scrollable: false,
        resizable: true,
        width: 1280, height: 880, left: 120, top: 70,
        min_width: 900, min_height: 600,
        style: UI::HtmlDialog::STYLE_DIALOG
      )
      @dlg.set_file(HTML)
      register_callbacks(@dlg)
      @dlg.show
    end

    def js(fn, payload)
      return unless @dlg && @dlg.visible?
      @dlg.execute_script("window.CM && CM.#{fn}(#{JSON.generate(payload)});")
    end

    def status(msg, kind = 'info')
      js('status', 'msg' => msg, 'kind' => kind)
    end

    def guard(name)
      yield
    rescue StandardError => e
      puts "Fence Builder Catalog #{name} error: #{e.message}\n#{e.backtrace.first(6).join("\n")}"
      status("#{name} failed: #{e.message}", 'error')
    end

    def payload
      {
        'builtin' => Catalog.builtin,
        'user' => Catalog.user_data,
        'photos' => Catalog.photos,
        'user_file' => Catalog.user_file
      }
    end

    # Basic shape check before anything is written to disk.
    def validate(user)
      raise 'Catalog must be an object' unless user.is_a?(Hash)
      lines = user['lines'] || []
      raise '"lines" must be a list' unless lines.is_a?(Array)
      ids = {}
      lines.each do |l|
        id = l['id'].to_s
        raise 'Every product line needs an id' if id.empty?
        raise "Product line id \"#{id}\" may only use letters, numbers, _ and -" unless id =~ /\A[A-Za-z0-9_\-]+\z/
        raise "Duplicate product line id \"#{id}\"" if ids[id]
        ids[id] = true
        raise "#{l['name'] || id}: add at least one height" if (l['heights'] || []).empty?
        raise "#{l['name'] || id}: pick at least one style" if (l['styles'] || []).empty?
        raise "#{l['name'] || id}: pick at least one color" if (l['colors'] || []).empty?
      end
      %w[styles colors].each do |k|
        raise "\"#{k}\" must be an object" unless (user[k] || {}).is_a?(Hash)
        (user[k] || {}).each_key do |id|
          raise "#{k[0..-2].capitalize} id \"#{id}\" may only use letters, numbers, _ and -" unless id =~ /\A[A-Za-z0-9_\-]+\z/
        end
      end
      user
    end

    def refresh_main
      Dialog.js('onCatalog', 'catalog' => Catalog.data, 'photos' => Catalog.photos) if Dialog.visible?
    end

    def register_callbacks(dlg)
      dlg.add_action_callback('ready') do |_ctx, *_args|
        guard('Load') { js('onInit', payload) }
      end

      dlg.add_action_callback('save') do |_ctx, json|
        guard('Save') do
          user = validate(JSON.parse(json))
          Catalog.save_user(user)
          refresh_main
          js('onSaved', payload)
          status("Saved. #{user['lines'].size} custom/modified line(s). Fence Builder is updated.", 'ok')
        end
      end

      dlg.add_action_callback('choose_photo') do |_ctx, key|
        guard('Photo') do
          path = UI.openpanel('Choose a photo', '', 'Images|*.jpg;*.jpeg;*.png;*.gif;*.webp||')
          if path
            Catalog.set_photo(key, path)
            js('onPhotos', Catalog.photos)
            refresh_main
            status('Photo added.', 'ok')
          end
        end
      end

      dlg.add_action_callback('remove_photo') do |_ctx, key|
        guard('Photo') do
          Catalog.remove_photo(key)
          js('onPhotos', Catalog.photos)
          refresh_main
          status('Photo removed.', 'ok')
        end
      end

      dlg.add_action_callback('export') do |_ctx, json|
        guard('Export') do
          path = UI.savepanel('Export catalog', '', 'fence_catalog.json')
          if path
            path += '.json' unless path.downcase.end_with?('.json')
            File.open(path, 'w') { |f| f.write(JSON.pretty_generate(JSON.parse(json))) }
            status("Exported to #{path}", 'ok')
          end
        end
      end

      dlg.add_action_callback('import') do |_ctx, *_args|
        guard('Import') do
          path = UI.openpanel('Import catalog', '', 'Catalog|*.json||')
          if path
            data = validate(Catalog.empty_user.merge(JSON.parse(File.read(path))))
            js('onImport', data)
          end
        end
      end

      dlg.add_action_callback('open_url') do |_ctx, json|
        guard('Open link') do
          url = json.to_s.start_with?('"') ? JSON.parse("[#{json}]").first : json.to_s
          UI.openURL(url) if url =~ %r{\Ahttps?://}
        end
      end

      dlg.add_action_callback('open_folder') do |_ctx, *_args|
        guard('Open folder') do
          FileUtils.mkdir_p(Catalog.user_photo_dir)
          UI.openURL(Catalog.file_url(Catalog.user_dir))
        end
      end
    end
  end
end
