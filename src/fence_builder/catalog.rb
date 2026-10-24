require 'json'

module FenceBuilder
  # Loads the product catalog (data/catalog.json) and resolves a full settings
  # hash for a product line + style. An optional data/user_catalog.json can add
  # or replace lines, styles and colors without touching the shipped catalog.
  module Catalog
    DATA_DIR  = File.join(File.dirname(__FILE__), 'data')
    PHOTO_DIR = File.join(File.dirname(__FILE__), 'photos')
    PHOTO_EXT = %w[.jpg .jpeg .png .gif .webp].freeze

    module_function

    def data
      @data ||= load_data
    end

    def reload!
      @data = nil
      data
    end

    def load_data
      base = JSON.parse(File.read(File.join(DATA_DIR, 'catalog.json')))
      user_file = File.join(DATA_DIR, 'user_catalog.json')
      merge_user(base, JSON.parse(File.read(user_file))) if File.exist?(user_file)
      base
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
    rescue StandardError => e
      puts "Fence Builder: could not merge user_catalog.json (#{e.message})"
    end

    def line(id)
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
      style_id = ln['styles'].first unless ln['styles'].include?(style_id)
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
      out['kind'] = line(out['line'])['kind']
      out
    end

    def style_label(s)
      ln = line(s['line'])
      st = style(s['style'])
      brand = ln['brand'] && ln['brand'] != 'Generic' ? "#{ln['brand']} " : ''
      "#{brand}#{ln['name']} - #{st['name'] || s['style']}"
    end

    # Photos: photos/<line>__<style>.jpg, photos/<style>.jpg or photos/<line>.jpg
    def photos
      map = {}
      return map unless File.directory?(PHOTO_DIR)
      Dir.entries(PHOTO_DIR).each do |f|
        ext = File.extname(f).downcase
        next unless PHOTO_EXT.include?(ext)
        map[File.basename(f, File.extname(f))] = file_url(File.join(PHOTO_DIR, f))
      end
      map
    end

    def file_url(path)
      p = path.tr('\\', '/')
      p = "/#{p}" unless p.start_with?('/')
      'file://' + p.gsub(' ', '%20')
    end
  end
end
