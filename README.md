# Fence Builder for SketchUp

A SketchUp extension (2017 or newer) that builds fences with real-world dimensions along a grouped line. It includes posts, panels and gates, and produces a bill of materials.

## Fence types

| Type | Product lines | Styles |
|---|---|---|
| Ornamental (Ameristar) | Montage Plus, Montage II, Echelon Plus, Aegis Plus, Aegis II, Impasse II | Majestic, Genesis, Classic, Invincible, Warrior, Trident |
| Chain link | Residential, Commercial, Security | Top rail, top & bottom rail, 3-rail, privacy slats, barbed wire |
| Wood | Privacy, Picket, Split Rail, Horizontal | Dog-ear, flat, shadowbox, board-on-board, cap & trim, lattice top, gothic, scalloped, arched, 2/3-rail, modern horizontal |
| Vinyl | Privacy, Picket, Ranch Rail | Solid, lattice top, semi-privacy, point, gothic, scalloped, 2/3/4-rail |

The dimensions are nominal values for modeling and estimating. Check the current manufacturer data sheets before you order.

**Gate types:** single swing, double swing, cantilever slide and V-track slide. Swing gates can be arched up or down, and can be drawn partly open. Each gate opening keeps its own type and settings.

## Install

1. Run `tools/build_rbz.sh`, or zip `src/fence_builder.rb` and the `src/fence_builder/` folder into a `.rbz` file.
2. In SketchUp, go to **Extensions > Extension Manager > Install Extension** and pick `fence_builder.rbz`.
3. Open the tool from **Extensions > Fence Builder** or from the **Fence Builder** toolbar.

## Use

1. Draw the fence line with the Line or Arc tool, then make it a group.
2. Select the group, pick a product line and style in the dialog, then click **Create fence**.
3. To add a gate, open the group and split the line where the gate goes. Select the gate edge, choose a gate type on the **Gates** tab, and click **Mark selected edge as gate**.
4. To change a fence, select it, adjust the settings, and click **Apply** (or turn on **Live update**). If you edit the line, click **Rebuild from line**.
5. To get a bill of materials, open the **Bill of Materials** tab or click **Export CSV**. It lists panels, posts, caps, brackets, gate hardware and concrete.

Racked panels follow sloped lines. If the slope is steeper than the product's maximum rack, the panels step instead. A corner post is placed wherever the line turns more than the corner angle, so arcs become smooth curved fences.

## Catalog Manager (add and edit products)

Open it from **Extensions > Fence Builder > Catalog Manager**, the toolbar, or the **Catalog Manager** button in the Fence Builder window.

- **Product lines:** add new lines (start from any existing line), or edit any built-in line. You can change the name, brand, fence type, heights, post-size rules, which styles and colors are offered, spec notes (shown on the BOM), photos, and every default dimension.
- **Styles:** create styles or change the built-in ones (top style, finials, rails, extensions, lattice, curves and more), and see a live preview on any line.
- **Colors:** add colors and choose which lines offer them.
- **Built-in items:** a built-in item is only copied into your catalog when you edit it, so it can always be reset. You can also hide built-in lines you don't sell.
- **Import / Export:** share your catalog with other computers or a team as a JSON file.

Your catalog and photos are saved per user, outside the plugin folder, so updating the plugin never erases them:

- Windows: `%APPDATA%\FenceBuilder\` (`user_catalog.json`, `photos\`)
- macOS: `~/Library/Application Support/FenceBuilder/`

## Develop

- `ruby test/run_catalog.rb` checks saving, merging, hiding, photos and validation of the user catalog.
- `ruby test/run_builds.rb [--obj]` builds every line and style outside SketchUp, using a stub of the SketchUp API, and checks the results. With `--obj` it also writes OBJ files to `test/out/`.
- `python3 test/render_obj.py test/out/<file>.obj out.png` renders a quick preview image of an OBJ file.
