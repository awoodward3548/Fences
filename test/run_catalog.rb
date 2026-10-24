# Checks the user catalog layer: saving, merging over the shipped catalog,
# hiding lines, photos, validation, and that custom lines build.
#
#   ruby test/run_catalog.rb [saved_user.json]
require 'tmpdir'
require_relative 'sketchup_stub'

tmp = Dir.mktmpdir('fence_catalog')
ENV['APPDATA'] = tmp
src = File.expand_path('../src/fence_builder', __dir__)
%w[util catalog geo path_parser panel_builder post_builder bom builder manager dialog catalog_manager].each do |f|
  require File.join(src, f)
end

def check(cond, msg)
  raise "FAILED: #{msg}" unless cond
  puts "ok - #{msg}"
end

C = FenceBuilder::Catalog
check(C.user_dir == File.join(tmp, 'FenceBuilder'), 'user data lives in the per-user folder')
check(C.user_data['lines'].empty?, 'starts with an empty user catalog')

user = if ARGV[0]
         JSON.parse(File.read(ARGV[0]))
       else
         line = JSON.parse(JSON.generate(C.line('vinyl_privacy')))
         line.merge!('id' => 'galveston_privacy', 'name' => 'Galveston Privacy', 'brand' => 'Bufftech',
                     'spec' => { 'Boards' => '7/8 x 6 T&G' })
         line['defaults']['post_spacing'] = 72
         inv = JSON.parse(JSON.generate(C.style('invincible')))
         inv['defaults']['top_ext'] = 6
         { 'lines' => [line], 'styles' => { 'invincible' => inv }, 'colors' => {}, 'hidden_lines' => [] }
       end
user['hidden_lines'] = ['montage_ii']
user['colors']['khaki'] = { 'name' => 'Khaki', 'rgb' => [195, 176, 145] }
user['lines'].first['colors'] = user['lines'].first['colors'] + ['khaki']

FenceBuilder::CatalogManager.validate(user)
C.save_user(user)
check(File.exist?(C.user_file), 'save_user writes user_catalog.json')
ids = C.data['lines'].map { |l| l['id'] }
check(ids.include?('galveston_privacy'), 'custom line is merged into the catalog')
check(!ids.include?('montage_ii'), 'hidden built-in line is left out')
check(C.builtin['lines'].any? { |l| l['id'] == 'montage_ii' }, 'shipped catalog is untouched')
check(C.style('invincible')['defaults']['top_ext'] == 6, 'modified built-in style overrides the shipped one')
check(C.color('khaki')['name'] == 'Khaki', 'custom color is available')
s = C.defaults('galveston_privacy', nil, nil)
check(s['post_spacing'] == 72 && s['kind'] == 'vinyl', 'line defaults resolve for the custom line')

bad = [
  { 'lines' => [{ 'id' => 'bad id', 'heights' => [48], 'styles' => ['majestic'], 'colors' => ['black'] }] },
  { 'lines' => [{ 'id' => 'x', 'heights' => [], 'styles' => ['majestic'], 'colors' => ['black'] }] },
  { 'lines' => [{ 'id' => 'x', 'heights' => [48], 'styles' => ['majestic'], 'colors' => ['black'] },
                { 'id' => 'x', 'heights' => [48], 'styles' => ['majestic'], 'colors' => ['black'] }] }
]
bad.each_with_index do |b, i|
  begin
    FenceBuilder::CatalogManager.validate(b)
    raise "FAILED: invalid catalog #{i} was accepted"
  rescue RuntimeError => e
    raise if e.message.start_with?('FAILED')
    puts "ok - rejects invalid catalog (#{e.message})"
  end
end

img = File.join(tmp, 'photo.png')
File.binwrite(img, 'png')
C.set_photo('galveston_privacy__vinyl_solid', img)
check(C.photos.key?('galveston_privacy__vinyl_solid'), 'photo is copied into the user photos folder')
C.remove_photo('galveston_privacy__vinyl_solid')
check(!C.photos.key?('galveston_privacy__vinyl_solid'), 'photo can be removed')

# Build every style of the custom line, with a kickboard variant of wood privacy too.
model = Sketchup::Model.new
Sketchup.instance_variable_set(:@model, model)
path = model.entities.add_group
[[[0, 0, 0], [300, 0, 0]], [[300, 0, 0], [300, 200, 12]], [[300, 200, 12], [300, 248, 12]]].each_with_index do |(a, b), i|
  e = Sketchup::Edge.new(path, a, b)
  e.set_attribute('FenceBuilder', 'gate', true) if i == 2
  path.entities.list << e
end
chains = FenceBuilder::PathParser.from_entity(path)
C.line('galveston_privacy')['styles'].each do |st|
  root = model.entities.add_group
  FenceBuilder::Manager.build(root, C.defaults('galveston_privacy', st), chains)
  bom = JSON.parse(root.get_attribute('FenceBuilder', 'bom'))
  check(bom['rows'].any? { |r| r['cat'] == 'Spec' }, "custom line builds (#{st}) with spec notes on the BOM")
end
s = C.defaults('wood_privacy', 'stockade_dogear').merge('kickboard' => true, 'kick_h' => 7.25)
root = model.entities.add_group
FenceBuilder::Manager.build(root, s, chains)
rows = JSON.parse(root.get_attribute('FenceBuilder', 'bom'))['rows']
check(rows.any? { |r| r['item'] == 'Kickboard' && r['qty'] > 0 }, 'kickboard is built and listed on the BOM')

FenceBuilder::Manager.save_last(s)
check(File.exist?(File.join(C.user_dir, 'last_settings.json')), 'last settings are saved in the user folder')
puts "\nCatalog checks passed"
