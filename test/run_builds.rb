# Builds every product line and style along a sample path (with slope, a
# curve, a corner, a T junction and every gate type) using the SketchUp stub,
# checks the results and writes OBJ files for visual inspection.
#
#   ruby test/run_builds.rb            # all lines/styles, summary only
#   ruby test/run_builds.rb --obj      # also write test/out/*.obj
require_relative 'sketchup_stub'
src = File.expand_path('../src/fence_builder', __dir__)
%w[util catalog geo path_parser panel_builder post_builder bom builder manager].each { |f| require File.join(src, f) }

OUT = File.expand_path('out', __dir__)
WRITE_OBJ = ARGV.include?('--obj')

def make_path(model, gate_types)
  g = model.entities.add_group
  pts = [[0, 0, 0], [400, 0, 0], [400, 300, 36]]
  # straight run with gates, each 4'/12' wide with fence between
  x = 400
  y = 300
  gate_types.each do |t|
    w = %w[single auto].include?(t) ? 48 : 144
    pts << [x, y + 96, 36]
    pts << [x, y + 96 + w, 36]
    y += 96 + w
  end
  pts << [x, y + 96, 36]
  y += 96
  # gentle curve
  8.times do |i|
    a = Math::PI / 2 * (i + 1) / 8
    pts << [x - 200 + 200 * Math.cos(a), y + 200 * Math.sin(a), 36]
  end
  edges = []
  pts.each_cons(2) { |a, b| edges << Sketchup::Edge.new(g, a, b) }
  # T junction branch
  edges << Sketchup::Edge.new(g, [200, 0, 0], [200, -150, 0])
  # mark gate edges: edges index 2,4,6.. (the second edge of each pair after corner)
  gate_types.each_with_index do |t, i|
    e = edges[3 + i * 2]
    e.set_attribute('FenceBuilder', 'gate', true)
    e.set_attribute('FenceBuilder', 'gate_type', t)
    e.set_attribute('FenceBuilder', 'gate_open', 30) if t == 'single'
    e.set_attribute('FenceBuilder', 'gate_arch', 'up') if t == 'double'
  end
  edges.each { |e| g.entities.list << e }
  g
end

def walk(ents, tr, mat, out)
  ents.meshes.each do |mesh, _flags, fm|
    m = fm ? fm.name : mat
    mesh.polygons.each do |poly|
      out << [m, poly.map { |i| tr.apply(mesh.points[i - 1]).to_a }]
    end
  end
  ents.list.each do |e|
    next unless e.is_a?(Sketchup::Group)
    walk(e.entities, tr * e.transformation, e.material ? e.material.name : mat, out)
  end
end

def write_obj(path, polys, model)
  mtl = path.sub(/\.obj$/, '.mtl')
  File.open(mtl, 'w') do |f|
    model.materials.each do |m|
      c = m.color.rgb.map { |v| (v / 255.0).round(3) }
      f.puts "newmtl #{m.name.tr(' ', '_')}\nKd #{c.join(' ')}\nd #{m.alpha}\n"
    end
  end
  File.open(path, 'w') do |f|
    f.puts "mtllib #{File.basename(mtl)}"
    vi = 1
    cur = nil
    polys.each do |m, pts|
      if m != cur
        f.puts "usemtl #{m.to_s.tr(' ', '_')}"
        cur = m
      end
      pts.each { |p| f.puts format('v %.3f %.3f %.3f', p[0], p[2], -p[1]) }
      f.puts 'f ' + (vi...(vi + pts.size)).to_a.join(' ')
      vi += pts.size
    end
  end
end

Dir.mkdir(OUT) if WRITE_OBJ && !Dir.exist?(OUT)
failures = []
gate_types = %w[single double cantilever vtrack]
cat = FenceBuilder::Catalog.data
cat['lines'].each do |ln|
  ln['styles'].each do |st|
    model = Sketchup::Model.new
    Sketchup.instance_variable_set(:@model, model)
    path = make_path(model, gate_types)
    chains = FenceBuilder::PathParser.from_entity(path)
    s = FenceBuilder::Catalog.defaults(ln['id'], st)
    s['show_footings'] = true
    root = model.entities.add_group
    begin
      FenceBuilder::Manager.build(root, s, chains)
      polys = []
      walk(root.entities, root.transformation, root.material && root.material.name, polys)
      bad = polys.count { |_, pts| pts.any? { |p| p.any? { |v| v.nan? || v.infinite? } } }
      bom = JSON.parse(root.get_attribute('FenceBuilder', 'bom'))
      sm = bom['summary']
      posts = root.entities.list.find { |g| g.name == 'Posts' }
      gates = root.entities.list.find { |g| g.name == 'Gates' }
      raise "NaN in #{bad} polygons" if bad > 0
      raise 'no gates built' unless gates && gates.entities.list.size == gate_types.size
      raise 'no posts' unless posts && posts.entities.list.size > 10
      puts format('%-16s %-16s polys=%6d panels=%3d posts=%3d gates=%d len=%s',
                  ln['id'], st, polys.size, sm['panels'], sm['posts'], sm['gates'], sm['length'])
      write_obj(File.join(OUT, "#{ln['id']}__#{st}.obj"), polys, model) if WRITE_OBJ
    rescue StandardError => e
      failures << "#{ln['id']}/#{st}: #{e.class} #{e.message}\n  #{e.backtrace.first(4).join("\n  ")}"
    end
  end
end

# Spot-check BOM rows for one fence
model = Sketchup::Model.new
Sketchup.instance_variable_set(:@model, model)
path = make_path(model, %w[single])
root = model.entities.add_group
FenceBuilder::Manager.build(root, FenceBuilder::Catalog.defaults('montage_plus', 'invincible'),
                            FenceBuilder::PathParser.from_entity(path))
puts "\nSample BOM (Montage Plus Invincible):"
JSON.parse(root.get_attribute('FenceBuilder', 'bom'))['rows'].each do |r|
  puts format('  %-14s %-52s %8s %-5s %s', r['cat'], r['item'], r['qty'], r['unit'], r['note'])
end

if failures.any?
  puts "\nFAILURES:"
  puts failures
  exit 1
end
puts "\nAll builds OK"
