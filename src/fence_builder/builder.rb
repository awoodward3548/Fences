module FenceBuilder
  # Assembles a whole fence (posts, panels, gates, footings) inside a root
  # group from path chains and resolved settings.
  class Builder
    TYPE_RANK = { 'line' => 0, 'end' => 1, 'corner' => 2, 'support' => 3, 'gate' => 4 }.freeze
    BRACKET_GAP = 0.25

    attr_reader :bom

    def initialize(model, root, settings, chains)
      @model = model
      @root = root
      @s = settings
      @chains = chains
    end

    def build
      s = @s
      @h = FenceBuilder.num(s['height'], 72)
      @mats = Materials.for_settings(@model, s)
      @root.material = @mats[:frame]
      ents = @root.entities
      @g_panels = sub_group(ents, 'Panels', 'Fence Panels')
      @g_posts  = sub_group(ents, 'Posts', 'Fence Posts')
      @g_gates  = sub_group(ents, 'Gates', 'Fence Gates')
      @show_footings = FenceBuilder.truthy?(s['show_footings'])
      @foot_ms = MeshSet.new if @show_footings
      @posts = {}
      @panel_jobs = []
      @gate_jobs = []
      @bom = Bom.new(s)

      @chains.each { |c| plan_chain(c) }
      @panel_jobs.each { |job| build_panel(*job) }
      @gate_jobs.each { |job| build_gate(*job) }
      build_posts
      if @show_footings && !@foot_ms.empty?
        g = sub_group(ents, 'Footings', 'Fence Footings')
        g.material = @mats[:concrete]
        @foot_ms.flush(g.entities)
      end
      [@g_panels, @g_posts, @g_gates].each { |g| g.erase! if g.valid? && g.entities.length.zero? }
      @bom
    end

    private

    def sub_group(ents, name, layer_name)
      g = ents.add_group
      g.name = name
      layer = @model.layers[layer_name] || @model.layers.add(layer_name)
      g.layer = layer
      g
    end

    def num(key, default = 0.0)
      FenceBuilder.num(@s[key], default)
    end

    # ------------------------------------------------------------ planning

    def hdist(a, b)
      Math.hypot(b[0] - a[0], b[1] - a[1])
    end

    def hdir(a, b)
      d = hdist(a, b)
      d < 1e-9 ? [1.0, 0.0, 0.0] : [(b[0] - a[0]) / d, (b[1] - a[1]) / d, 0.0]
    end

    def corner?(a, b, c)
      d1 = hdir(a, b)
      d2 = hdir(b, c)
      return false if hdist(a, b) < 1e-6 || hdist(b, c) < 1e-6
      dot = d1[0] * d2[0] + d1[1] * d2[1]
      dot = [[dot, -1.0].max, 1.0].min
      Math.acos(dot) * 180.0 / Math::PI > num('corner_angle', 15)
    end

    def endpoint_type(chain, idx)
      last = chain['pts'].size - 1
      return 'corner' if chain['closed'] || (idx > 0 && idx < last)
      deg = idx.zero? ? chain['deg'][0] : chain['deg'][1]
      deg.to_i <= 1 ? 'end' : 'corner'
    end

    def plan_chain(chain)
      pts = chain['pts']
      gates = chain['gates']
      runs = []
      cur = nil
      (0...(pts.size - 1)).each do |i|
        g = gates[i]
        if g
          runs << cur if cur
          cur = nil
          runs << { gate: g, a: pts[i], b: pts[i + 1], ia: i, ib: i + 1 }
        else
          if cur && corner?(pts[i - 1], pts[i], pts[i + 1])
            runs << cur
            cur = nil
          end
          cur ||= { pts: [pts[i]], i0: i }
          cur[:pts] << pts[i + 1]
        end
      end
      runs << cur if cur

      runs.each do |run|
        if run[:gate]
          dir = hdir(run[:a], run[:b])
          ka = register_post(run[:a], 'gate', dir)
          kb = register_post(run[:b], 'gate', dir)
          @gate_jobs << [ka, kb, run[:gate]]
        else
          i1 = run[:i0] + run[:pts].size - 1
          plan_run(run[:pts], endpoint_type(chain, run[:i0]), endpoint_type(chain, i1))
        end
      end
    end

    def plan_run(p, type_a, type_b)
      d = [0.0]
      (1...p.size).each { |k| d << d[-1] + hdist(p[k - 1], p[k]) }
      total = d[-1]
      return if total < 1.0
      @bom.add_run_length(total)
      sp = num('post_spacing', 96)
      sp = 12.0 if sp < 12
      stations =
        if @s['spacing_mode'] == 'full'
          k = (total / sp + 1e-6).floor
          st = (0..k).map { |i| i * sp }
          if total - st[-1] > 2.0
            st << total
          else
            st[-1] = total
          end
          st
        else
          n = [(total / sp - 1e-6).ceil, 1].max
          (0..n).map { |i| total * i / n }
        end
      keys = stations.each_with_index.map do |t, i|
        pt, dir = point_at(p, d, t)
        type = i.zero? ? type_a : (i == stations.size - 1 ? type_b : 'line')
        register_post(pt, type, dir)
      end
      (0...(keys.size - 1)).each { |i| @panel_jobs << [keys[i], keys[i + 1]] unless keys[i] == keys[i + 1] }
    end

    def point_at(p, d, t)
      k = 0
      k += 1 while k < p.size - 2 && d[k + 1] < t
      seg = d[k + 1] - d[k]
      u = seg < 1e-9 ? 0.0 : (t - d[k]) / seg
      a = p[k]
      b = p[k + 1]
      [[a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u], hdir(a, b)]
    end

    def register_post(pt, type, dir)
      key = [(pt[0] * 10).round, (pt[1] * 10).round]
      post = @posts[key]
      if post
        post[:type] = type if TYPE_RANK[type] > TYPE_RANK[post[:type]]
      else
        @posts[key] = { pt: pt, type: type, dir: dir, top: pt[2] + @h }
      end
      key
    end

    def post_size(type)
      base = num('post_size', 2.5)
      case type
      when 'gate', 'support'
        [num('gate_post_size'), base].max
      when 'end', 'corner'
        t = num('terminal_post_size')
        t > 0 ? t : base
      else
        base
      end
    end

    def frame_tr(origin, dir)
      Geom::Transformation.axes(Geo.pt(origin), Geom::Vector3d.new(dir[0], dir[1], 0),
                                Geom::Vector3d.new(-dir[1], dir[0], 0), Geom::Vector3d.new(0, 0, 1))
    end

    def bump_top(key, z)
      @posts[key][:top] = z if z > @posts[key][:top]
    end

    # -------------------------------------------------------------- panels

    def build_panel(ka, kb)
      a = @posts[ka]
      b = @posts[kb]
      pa = a[:pt]
      pb = b[:pt]
      hd = hdist(pa, pb)
      return if hd < 1.0
      dir = hdir(pa, pb)
      ha = post_size(a[:type]) / 2
      hb = post_size(b[:type]) / 2
      gap = @s['infill'] == 'vertical' ? BRACKET_GAP : 0.0
      x0 = ha + gap
      w = hd - ha - hb - 2 * gap
      return if w < 1.0

      rise = pb[2] - pa[2]
      allowed = num('max_rack', 30) * hd / [num('post_spacing', 96), 1].max
      racked = case @s['slope_mode']
               when 'rack' then true
               when 'step' then rise.abs < 0.01
               else rise.abs <= allowed + 0.01
               end
      if racked
        m = rise / hd
        g0 = pa[2] + m * x0
      else
        m = 0.0
        g0 = [pa[2], pb[2]].max
      end

      origin = [pa[0] + dir[0] * x0, pa[1] + dir[1] * x0, 0.0]
      grp = @g_panels.entities.add_group
      ms = MeshSet.new
      pb_builder = PanelBuilder.new(@s, ms, @mats[:infill], @mats[:hardware], @mats)
      curve = { type: @s['curve'], h: num('curve_h'), x0: 0, cw: w }
      stats = pb_builder.build(w, g0: g0, m: m, curve: curve, ext_a: x0, ext_b: hb + gap)
      ms.flush(grp.entities)
      grp.transformation = frame_tr(origin, dir)
      std_w = num('post_spacing', 96) - num('post_size', 2.5) - 2 * gap
      cut = w < std_w - 1.0 ? "cut from #{FenceBuilder.fmt_in(std_w)} stock" : nil
      grp.name = "#{@bom.section_word} #{FenceBuilder.fmt_in(w)}#{racked ? '' : ' (stepped)'}"
      @bom.panel(w, racked, rise, stats, cut)

      extra = @s['infill'] == 'chain_link' ? num('net_above') : 0.0
      bump_top(ka, g0 + @h + extra)
      bump_top(kb, g0 + m * w + @h + extra)
    end

    # --------------------------------------------------------------- gates

    def build_gate(ka, kb, opts)
      gs = @s.merge(opts || {})
      ka, kb = kb, ka if FenceBuilder.truthy?(gs['gate_flip'])
      a = @posts[ka]
      b = @posts[kb]
      pa = a[:pt]
      pb = b[:pt]
      hd = hdist(pa, pb)
      dir = hdir(pa, pb)
      ha = post_size(a[:type]) / 2
      hb = post_size(b[:type]) / 2
      opening = hd - ha - hb
      return if opening < 6

      type = gs['gate_type'] || 'auto'
      type = (opening <= FenceBuilder.num(gs['gate_single_max'], 72) ? 'single' : 'double') if type == 'auto'
      zbase = [pa[2], pb[2]].max
      hinge = FenceBuilder.num(gs['gate_hinge_gap'], 1)
      latch = FenceBuilder.num(gs['gate_latch_gap'], 1)
      center = FenceBuilder.num(gs['gate_center_gap'], 1)
      angle = FenceBuilder.num(gs['gate_open']) * Math::PI / 180.0
      arch = gs['gate_arch']
      arch_type = { 'up' => 'convex', 'down' => 'concave' }[arch]
      arch_h = FenceBuilder.num(gs['gate_arch_h'], 8)
      unless arch_type
        arch_type = @s['curve']
        arch_h = num('curve_h')
      end
      arch_h = 0 if arch_type.nil? || arch_type == 'none'
      top = zbase + @h + (arch_type == 'convex' ? arch_h : 0)
      leaf_h = @h + (arch_type == 'convex' ? arch_h : 0)
      hinges_per_leaf = leaf_h > 60 ? 3 : 2

      grp = @g_gates.entities.add_group
      grp.transformation = frame_tr([pa[0], pa[1], 0.0], dir)
      hw = MeshSet.new
      hmesh = hw[@mats[:hardware]]
      clr = FenceBuilder.num(gs['gate_clearance'], 2)
      label = FenceBuilder.fmt_len(opening)
      ht = FenceBuilder.fmt_len(@h)

      case type
      when 'single'
        lw = opening - hinge - latch
        leaf(grp, gs, lw, ha + hinge, 0, zbase, clr, { type: arch_type, h: arch_h, x0: 0, cw: lw }, angle, 0)
        hinge_marks(hmesh, ha, hinge, zbase, clr, leaf_h, hinges_per_leaf)
        Geo.abox(hmesh, ha + opening - latch - 1, ha + opening, -1, 1, zbase + leaf_h * 0.55, zbase + leaf_h * 0.55 + 4)
        grp.name = "Gate - single swing #{label}"
        @bom.gate(name: "Single swing gate #{label} opening x #{ht} H", opening: opening,
                  note: "leaf #{FenceBuilder.fmt_in(lw)}")
        @bom.hardware('Gate hinges', hinges_per_leaf)
        @bom.hardware('Gate latch', 1)
      when 'double'
        lw = (opening - 2 * hinge - center) / 2
        cw = 2 * lw + center
        xl = ha + hinge
        xr = xl + lw + center
        leaf(grp, gs, lw, xl, 0, zbase, clr, { type: arch_type, h: arch_h, x0: 0, cw: cw }, angle, 0)
        leaf(grp, gs, lw, xr, 0, zbase, clr, { type: arch_type, h: arch_h, x0: lw + center, cw: cw }, -angle, lw)
        hinge_marks(hmesh, ha, hinge, zbase, clr, leaf_h, hinges_per_leaf)
        hinge_marks(hmesh, hd - hb - hinge, hinge, zbase, clr, leaf_h, hinges_per_leaf)
        if angle.abs < 1e-6
          Geo.cyl(hmesh, [xr + 1.5, 1.5, zbase - 2], [xr + 1.5, 1.5, zbase + clr + 24], 0.3, 6)
        end
        grp.name = "Gate - double swing #{label}"
        @bom.gate(name: "Double swing gate #{label} opening x #{ht} H", opening: opening,
                  note: "2 leaves @ #{FenceBuilder.fmt_in(lw)}")
        @bom.hardware('Gate hinges', hinges_per_leaf * 2)
        @bom.hardware('Gate latch (double gate)', 1)
        @bom.hardware('Drop rod / cane bolt', 1)
      when 'cantilever'
        tail = [(opening * 0.5 / 6.0).ceil * 6, 48].max
        lw = opening + tail + 4
        off = hb + 3 + FenceBuilder.num(gs['gate_frame'], 2)
        clr = [clr, 4].max
        leaf(grp, gs, lw, ha + 1, off, zbase, clr, nil, 0, 0)
        sx = hd + tail - 6
        sp = [pa[0] + dir[0] * sx, pa[1] + dir[1] * sx, pb[2]]
        ks = register_post(sp, 'support', dir)
        bump_top(ks, top)
        [hd, sx].each do |x|
          [zbase + clr + 3, zbase + leaf_h - 6].each do |z|
            Geo.abox(hmesh, x - 2, x + 2, hb, off, z - 1.5, z + 1.5)
          end
        end
        grp.name = "Gate - cantilever slide #{label}"
        @bom.gate(name: "Cantilever slide gate #{label} opening x #{ht} H", opening: opening,
                  note: "leaf #{FenceBuilder.fmt_len(lw)} incl. #{FenceBuilder.fmt_len(tail)} tail; extra support post")
        @bom.hardware('Cantilever roller trucks', 4)
        @bom.hardware('Slide gate latch', 1)
        @bom.hardware('Gate stop / receiver', 1)
      when 'vtrack'
        lw = opening + 8
        off = hb + 2 + FenceBuilder.num(gs['gate_frame'], 2)
        clr = [clr, 6].max
        leaf(grp, gs, lw, ha + 1, off, zbase, clr, nil, 0, 0)
        track_len = hd + opening + 12
        Geo.abox(hmesh, 0, track_len, off - 0.75, off + 0.75, zbase, zbase + 1)
        [ha + 9, ha + lw - 7].each do |x|
          Geo.cyl(hw[@mats[:hardware], true], [x, off - 1, zbase + 4], [x, off + 1, zbase + 4], 3, 12)
        end
        Geo.abox(hmesh, hd - 2, hd + 2, hb, off, zbase + leaf_h - 8, zbase + leaf_h - 4)
        grp.name = "Gate - V-track slide #{label}"
        @bom.gate(name: "V-track roll gate #{label} opening x #{ht} H", opening: opening,
                  note: "leaf #{FenceBuilder.fmt_len(lw)}; track #{FenceBuilder.fmt_len(track_len)}")
        @bom.hardware('V-groove wheels', 2)
        @bom.hardware('V-track (ft)', (track_len / 12.0).ceil)
        @bom.hardware('Guide roller', 1)
        @bom.hardware('Slide gate latch', 1)
      end
      hw.flush(grp.entities)
      bump_top(ka, top)
      bump_top(kb, top)
    end

    # Adds one gate leaf as its own group (so it can be swung or moved).
    def leaf(parent, gs, w, x, y, zbase, clearance, curve, angle, pivot_x)
      return if w < 2
      g = parent.entities.add_group
      g.name = 'Gate leaf'
      ms = MeshSet.new
      PanelBuilder.new(gs, ms, @mats[:infill], @mats[:hardware], @mats)
                  .build(w, g0: 0, m: 0, frame: true, clearance: clearance, curve: curve)
      ms.flush(g.entities)
      tr = Geom::Transformation.translation(Geom::Vector3d.new(x, y, zbase))
      if angle.abs > 1e-6
        tr *= Geom::Transformation.rotation(Geom::Point3d.new(pivot_x, 0, 0), Geom::Vector3d.new(0, 0, 1), angle)
      end
      g.transformation = tr
    end

    def hinge_marks(mesh, x, gap, zbase, clr, leaf_h, count)
      zs = [zbase + clr + 6, zbase + clr + leaf_h - 10]
      zs.insert(1, zbase + clr + leaf_h / 2 - 2) if count > 2
      zs.each { |z| Geo.abox(mesh, x, x + [gap, 0.5].max, -1, 1, z, z + 4) }
    end

    # --------------------------------------------------------------- posts

    def build_posts
      round = @s['post_shape'] == 'round'
      embed = num('embed_depth', 30)
      above_extra = num('post_above', 1)
      @posts.each_value do |p|
        size = post_size(p[:type])
        ground = p[:pt][2]
        above = p[:top] - ground + above_extra
        below = @show_footings ? [embed - 4, 0].max : 0.0
        grp = @g_posts.entities.add_group
        grp.name = "#{p[:type].capitalize} post"
        ms = MeshSet.new
        PostBuilder.build(ms, @s, size, above, p[:type], below)
        ms.flush(grp.entities)
        grp.transformation = frame_tr(p[:pt], p[:dir])
        len = ((above + embed) / 6.0).ceil * 6
        @bom.post(p[:type], size, len, round)
        @bom.footing(num('footing_dia', 10), embed, size, round)
        PostBuilder.footing(@foot_ms[nil, true], p[:pt], num('footing_dia', 10), embed) if @show_footings
      end
    end
  end

  # Fence materials (created on demand, shared between fences).
  module Materials
    module_function

    def get(model, id, alpha = 1.0, suffix = '')
      c = Catalog.color(id)
      return nil unless c
      name = "Fence #{c['name']}#{suffix}"
      m = model.materials[name] || model.materials.add(name)
      m.color = Sketchup::Color.new(*c['rgb'])
      m.alpha = alpha
      m
    end

    def custom(model, name, rgb, alpha = 1.0)
      m = model.materials[name] || model.materials.add(name)
      m.color = Sketchup::Color.new(*rgb)
      m.alpha = alpha
      m
    end

    def for_settings(model, s)
      frame = get(model, s['color'])
      infill = nil
      icol = s['infill_color'].to_s
      if s['infill'] == 'netting'
        infill = get(model, icol.empty? ? 'black' : icol, 0.35, ' Net')
      elsif s['infill'] == 'chain_link'
        if FenceBuilder.truthy?(s['slats'])
          infill = get(model, icol.empty? ? 'green' : icol, 1.0, ' Slats')
        else
          infill = get(model, icol.empty? ? s['color'] : icol, 0.45, ' Mesh')
        end
      elsif !icol.empty? && icol != s['color']
        infill = get(model, icol)
      end
      {
        frame: frame,
        infill: infill,
        windscreen: get(model, s['windscreen_color'].to_s.empty? ? 'green' : s['windscreen_color'], 0.92, ' Windscreen'),
        net: get(model, s['net_color'].to_s.empty? ? 'black' : s['net_color'], 0.35, ' Net'),
        hardware: custom(model, 'Fence Hardware', [60, 62, 66]),
        concrete: custom(model, 'Fence Concrete', [188, 186, 180], 0.6)
      }
    end
  end
end
