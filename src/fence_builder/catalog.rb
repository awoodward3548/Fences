require 'json'
require 'fileutils'

module FenceBuilder
  # Loads the product catalog and resolves a full settings hash for a product
  # line + style.
  #
  # The shipped catalog (data/catalog.json) is read-only. Everything a user
  # adds or changes in the Catalog Manager is saved to user_catalog.json in a
  # per-user folder (see Catalog.user_dir), so it survives plugin updates:
  #   { "lines": [...], "styles": {...}, "colors": {...}, "hidden_lines": [...] }
  # Lines/styles/colors with the same id as a shipped one replace it.
  module Catalog
    DATA_DIR  = File.join(File.dirname(__FILE__), 'data')
    PHOTO_DIR = File.join(File.dirname(__FILE__), 'photos')
    PHOTO_EXT = %w[.jpg .jpeg .png .gif .webp].freeze
    LEGACY_USER_FILE = File.join(DATA_DIR, 'user_catalog.json')

    module_function

    def user_dir
      @user_dir ||= begin
        base = if ENV['APPDATA'] && !ENV['APPDATA'].empty?
                 ENV['APPDATA']
               elsif RUBY_PLATFORM =~ /darwin/
                 File.join(Dir.home, 'Library', 'Application Support')
               else
                 Dir.home
               end
        dir = File.join(base, 'FenceBuilder')
        dir.force_encoding('UTF-8') if dir.respond_to?(:force_encoding)
        dir
      end
    end

    def user_file
      File.join(user_dir, 'user_catalog.json')
    end

    def user_photo_dir
      File.join(user_dir, 'photos')
    end

    def data
      @data ||= load_data
    end

    def reload!
      @data = nil
      @builtin = nil
      data
    end

    def builtin
      @builtin ||= JSON.parse(File.read(File.join(DATA_DIR, 'catalog.json')))
    end

    def empty_user
      { 'lines' => [], 'styles' => {}, 'colors' => {}, 'hidden_lines' => [] }
    end

    def user_data
      path = File.exist?(user_file) ? user_file : (File.exist?(LEGACY_USER_FILE) ? LEGACY_USER_FILE : nil)
      return empty_user unless path
      empty_user.merge(JSON.parse(File.read(path)))
    rescue StandardError => e
      puts "Fence Builder: could not read #{path} (#{e.message})"
      empty_user
    end

    def save_user(user)
      FileUtils.mkdir_p(user_dir)
      tmp = "#{user_file}.tmp"
      File.open(tmp, 'w') { |f| f.write(JSON.pretty_generate(user)) }
      File.rename(tmp, user_file)
      reload!
    end

    def load_data
      merge_user(JSON.parse(JSON.generate(builtin)), user_data)
    end

    def merge_user(base, user)
      %w[colors styles kinds].each do |k|
        base[k].merge!(user[k]) if user[k].is_a?(Hash)
      end
      base['base'].merge!(user['base']) if user['base'].is_a?(Hash)
      (user['lines'] || []).each do |line|
        idx = base['lines'].index { |l| l['id'] == line['id'] }
        idx ? base['lines'][idx] = line : base['lines'] << line
      end
      hidden = user['hidden_lines'] || []
      base['lines'].reject! { |l| hidden.include?(l['id']) } if hidden.size < base['lines'].size
      base
    rescue StandardError => e
      puts "Fence Builder: could not merge the user catalog (#{e.message})"
      base
    end

    # Old line ids (from earlier versions) map to their replacements so
    # existing fences keep rebuilding with the right product.
    def line(id)
      id = (data['aliases'] || {})[id] || id
      data['lines'].find { |l| l['id'] == id } || data['lines'].first
    end

    def style(id)
      data['styles'][id] || {}
    end

    def color(id)
      data['colors'][id]
    end

    # Default post size for a line at a given height.
    def post_size_for(line, height)
      rules = line['post_rules'] || []
      rule = rules.find { |max_h, _| height.to_f <= max_h.to_f }
      rule ? rule[1].to_f : nil
    end

    # Full defaults for a line/style/height (no user overrides).
    def defaults(line_id, style_id = nil, height = nil)
      ln = line(line_id)
      styles = ln['styles'] || []
      style_id = styles.first unless styles.include?(style_id)
      s = {}
      s.merge!(data['base'])
      s.merge!(ln['defaults'] || {})
      s.merge!(style(style_id)['defaults'] || {})
      s['line'] = ln['id']
      s['style'] = style_id
      s['kind'] = ln['kind']
      s['height'] = height.to_f if height && height.to_f > 0
      ps = post_size_for(ln, s['height'])
      s['post_size'] = ps if ps
      s
    end

    # Fill in any missing keys of a (possibly partial) settings hash.
    def resolve(settings)
      settings = settings || {}
      d = defaults(settings['line'], settings['style'], settings['height'])
      out = d.merge(settings)
      ln = line(out['line'])
      out['line'] = ln['id']
      out['kind'] = ln['kind']
      out
    end

    def style_label(s)
      ln = line(s['line'])
      st = style(s['style'])
      brand = ln['brand'] && !ln['brand'].empty? && ln['brand'] != 'Generic' ? "#{ln['brand']} " : ''
      "#{brand}#{ln['name']} - #{st['name'] || s['style']}"
    end

    # Photos: <line>__<style>.jpg or <style>.jpg, from the plugin's photos
    # folder and the user's photos folder (user photos win).
    def photos
      map = {}
      [PHOTO_DIR, user_photo_dir].each do |dir|
        next unless File.directory?(dir)
        Dir.entries(dir).each do |f|
          ext = File.extname(f).downcase
          next unless PHOTO_EXT.include?(ext)
          path = File.join(dir, f)
          map[File.basename(f, File.extname(f))] = "#{file_url(path)}?v=#{File.mtime(path).to_i}"
        end
      end
      map
    end

    # Copy an image into the user photos folder as <key>.<ext>.
    def set_photo(key, src)
      ext = File.extname(src).downcase
      raise "Unsupported image type #{ext}" unless PHOTO_EXT.include?(ext)
      raise 'Invalid photo name' unless key =~ /\A[A-Za-z0-9_\-]+\z/
      FileUtils.mkdir_p(user_photo_dir)
      remove_photo(key)
      FileUtils.cp(src, File.join(user_photo_dir, "#{key}#{ext}"))
    end

    def remove_photo(key)
      return unless key =~ /\A[A-Za-z0-9_\-]+\z/
      PHOTO_EXT.each do |ext|
        path = File.join(user_photo_dir, "#{key}#{ext}")
        File.delete(path) if File.exist?(path)
      end
    end

    def file_url(path)
      p = path.tr('\\', '/')
      p = "/#{p}" unless p.start_with?('/')
      'file://' + p.gsub(' ', '%20')
    end
  end
end
