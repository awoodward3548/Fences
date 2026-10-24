require 'json'

module FenceBuilder
  # The Fence Builder window (UI::HtmlDialog, SketchUp 2017+).
  module Dialog
    HTML = File.join(File.dirname(__FILE__), 'html', 'dialog.html')

    module_function

    def show
      if @dlg && @dlg.visible?
        @dlg.bring_to_front
        return
      end
      @dlg = UI::HtmlDialog.new(
        dialog_title: 'Fence Builder',
        preferences_key: 'FenceBuilder.Dialog',
        scrollable: false,
        resizable: true,
        width: 1220, height: 860, left: 80, top: 60,
        min_width: 760, min_height: 560,
        style: UI::HtmlDialog::STYLE_DIALOG
      )
      @dlg.set_file(HTML)
      register_callbacks(@dlg)
      @dlg.set_on_closed { detach_observer } if @dlg.respond_to?(:set_on_closed)
      @dlg.show
      attach_observer
    end

    def visible?
      @dlg && @dlg.visible?
    end

    def js(fn, payload)
      return unless visible?
      @dlg.execute_script("window.FB && FB.#{fn}(#{JSON.generate(payload)});")
    end

    def status(msg, kind = 'info')
      js('status', 'msg' => msg, 'kind' => kind)
    end

    def push_selection
      js('onSelection', Manager.selection_info)
    rescue StandardError => e
      puts "Fence Builder: #{e.message}"
    end

    def guard(name)
      yield
    rescue StandardError => e
      puts "Fence Builder #{name} error: #{e.message}\n#{e.backtrace.first(6).join("\n")}"
      status("#{name} failed: #{e.message}", 'error')
    end

    def parse(json)
      json.is_a?(String) ? JSON.parse(json) : (json || {})
    end

    def register_callbacks(dlg)
      dlg.add_action_callback('ready') do |_ctx, *_args|
        guard('Init') do
          js('onInit', 'catalog' => Catalog.data, 'photos' => Catalog.photos,
                       'settings' => Manager.last_settings, 'selection' => Manager.selection_info)
        end
      end

      dlg.add_action_callback('create') do |_ctx, json|
        guard('Create') do
          made = Manager.create(parse(json))
          status(made.empty? ? 'Nothing created.' : "Created #{made.size} fence(s).", made.empty? ? 'warn' : 'ok')
          push_selection
        end
      end

      dlg.add_action_callback('apply') do |_ctx, json|
        guard('Update') do
          done = Manager.update(parse(json))
          status(done.empty? ? 'Select a fence to update.' : "Updated #{done.size} fence(s).", done.empty? ? 'warn' : 'ok')
          push_selection
        end
      end

      dlg.add_action_callback('rebuild') do |_ctx, *_args|
        guard('Rebuild') do
          done = Manager.rebuild
          status(done.empty? ? 'Select a fence to rebuild.' : "Rebuilt #{done.size} fence(s) from their path.", done.empty? ? 'warn' : 'ok')
          push_selection
        end
      end

      dlg.add_action_callback('mark_gate') do |_ctx, json|
        guard('Mark gate') do
          n = Manager.mark_gates(parse(json))
          status("Marked #{n} edge(s) as gate. Linked fences were rebuilt.", 'ok') if n > 0
          push_selection
        end
      end

      dlg.add_action_callback('unmark_gate') do |_ctx, *_args|
        guard('Unmark gate') do
          n = Manager.unmark_gates
          status(n > 0 ? "Removed gate from #{n} edge(s)." : 'Select gate edges first.', n > 0 ? 'ok' : 'warn')
          push_selection
        end
      end

      dlg.add_action_callback('export_bom') do |_ctx, *_args|
        guard('Export') { Manager.export_bom }
      end

      dlg.add_action_callback('open_photos') do |_ctx, *_args|
        guard('Photos') { UI.openURL(Catalog.file_url(Catalog::PHOTO_DIR)) }
      end

      dlg.add_action_callback('reload_catalog') do |_ctx, *_args|
        guard('Reload') do
          Catalog.reload!
          js('onCatalog', 'catalog' => Catalog.data, 'photos' => Catalog.photos)
          status('Catalog and photos reloaded.', 'ok')
        end
      end

      dlg.add_action_callback('open_url') do |_ctx, json|
        guard('Open link') do
          url = json.to_s.start_with?('"') ? JSON.parse("[#{json}]").first : json.to_s
          UI.openURL(url) if url =~ %r{\Ahttps?://}
        end
      end

      dlg.add_action_callback('open_catalog') do |_ctx, *_args|
        guard('Catalog Manager') { CatalogManager.show }
      end

      dlg.add_action_callback('refresh') do |_ctx, *_args|
        push_selection
      end
    end

    # Keep the dialog in sync with what is selected in the model.
    class SelectionSync < Sketchup::SelectionObserver
      def onSelectionBulkChange(_sel)
        schedule
      end

      def onSelectionCleared(_sel)
        schedule
      end

      def onSelectionAdded(_sel, _ent)
        schedule
      end

      def onSelectionRemoved(_sel, _ent)
        schedule
      end

      def schedule
        return if @pending
        @pending = true
        UI.start_timer(0.15, false) do
          @pending = false
          Dialog.push_selection
        end
      end
    end

    def attach_observer
      detach_observer
      @observer = SelectionSync.new
      @observed = Sketchup.active_model.selection
      @observed.add_observer(@observer)
    end

    def detach_observer
      @observed.remove_observer(@observer) if @observed && @observer
    rescue StandardError
      nil
    ensure
      @observer = nil
      @observed = nil
    end
  end
end
