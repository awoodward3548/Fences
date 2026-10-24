# Fence Builder for SketchUp
# Builds real-world fences (ornamental, chain link, wood and vinyl) along a
# grouped path of edges, with gates, live editing and a bill of materials.

require 'sketchup.rb'
require 'extensions.rb'

module FenceBuilder
  PLUGIN_ID = 'fence_builder'.freeze

  file = __FILE__.dup
  file.force_encoding('UTF-8') if file.respond_to?(:force_encoding)
  PLUGIN_ROOT = File.dirname(file).freeze

  unless file_loaded?(__FILE__)
    ex = SketchupExtension.new('Fence Builder', File.join(PLUGIN_ID, 'main'))
    ex.description = 'Create real-world fences (ornamental, chain link, wood, vinyl) ' \
                     'with gates along a grouped line. Swap styles visually, adjust ' \
                     'heights, spacing and rails, and export a bill of materials.'
    ex.version     = '1.0.0'
    ex.creator     = 'Fence Builder'
    ex.copyright   = '2026'
    Sketchup.register_extension(ex, true)
    file_loaded(__FILE__)
  end
end
