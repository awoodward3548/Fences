module FenceBuilder
  # Builds the infill between two posts (a "panel" or "section") or a gate
  # leaf, in panel-local coordinates:
  #   x runs along the fence from the clear start (0) to the clear end (w),
  #   y runs across the fence (+y = the "front" / outside face),
  #   z is absolute height; the ground under the panel is g(x) = g0 + m * x.
  class PanelBuilder
    attr_reader :stats

    # s: resolved settings, ms: MeshSet, infill_mat: material for boards,
    # pickets or fabric (nil = inherit fence color)
    def initialize(s, ms, infill_mat = nil, hardware_mat = nil)
      @s = s
      @ms = ms
      @imat = infill_mat
      @hmat = hardware_mat
    end

    # Options:
    #   :g0, :m      ground line (absolute z at x=0, slope)
    #   :frame       true for gate leaves (adds stiles / pipe frame)
    #   :clearance   override ground clearance
    #   :curve       { type: 'convex'|'concave', h:, x0:, cw: } top curve
    #   :ext_a/:ext_b  distance from clear start/end back to post centers
    #                  (face-mounted boards and chain link fabric run to them)
    def build(w, o = {})
      @w = w.to_f
      @g0 = (o[:g0] || 0).to_f
      @m = (o[:m] || 0).to_f
      @frame = o[:frame] ? true : false
      @clear = (o[:clearance] || FenceBuilder.num(@s['clearance'], 2)).to_f
      @curve = o[:curve]
      @ext_a = (o[:ext_a] || 0).to_f
      @ext_b = (o[:ext_b] || 0).to_f
      @stats = Hash.new(0)
      case @s['infill']
      when 'horizontal' then horizontal
      when 'chain_link' then chain_link
      else vertical
      end
      @stats
    end

    private

    def f(key, default = 0.0)
      FenceBuilder.num(@s[key], default)
    end

    def on?(key)
      FenceBuilder.truthy?(@s[key])
    end

    def g(x)
      @g0 + @m * x
    end

    def frame_mesh
      @ms[nil]
    end

    def infill_mesh
      @ms[@imat]
    end

    def curve(x)
      c = @curve
      return 0.0 unless c && c[:h].to_f > 0 && %w[convex concave].include?(c[:type])
      t = (x + c[:x0].to_f) / c[:cw].to_f
      t = 0.0 if t < 0
      t = 1.0 if t > 1
      v = Math.sin(Math::PI * t) * c[:h].to_f
      c[:type] == 'concave' ? -v : v
    end

    def curved?
      c = @curve
      c && c[:h].to_f > 0 && %w[convex concave].include?(c[:type])
    end

    # A rail from x0 to x1 whose bottom sits zb above the ground line,
    # optionally following the top curve.
    def rail(mesh, x0, x1, zb, y0, y1, h, follow_curve = false)
      if follow_curve && curved?
        k = 12
        k.times do |i|
          xa = x0 + (x1 - x0) * i / k
          xb = x0 + (x1 - x0) * (i + 1) / k
          Geo.beam(mesh, xa, g(xa) + zb + curve(xa), xb, g(xb) + zb + curve(xb), y0, y1, h)
        end
      else
        Geo.beam(mesh, x0, g(x0) + zb, x1, g(x1) + zb, y0, y1, h)
      end
    end

    # Evenly distributed picket centers within [0, span], gaps <= air.
    def layout(span, pw, air)
      return [] if span < pw
      n = if air <= 0.01
            (span / pw).floor
          else
            ((span - air) / (pw + air)).ceil
          end
      n = 1 if n < 1
      n -= 1 while n > 1 && n * pw > span
      gap = (span - n * pw) / (n + 1)
      Array.new(n) { |i| gap * (i + 1) + pw * (i + 0.5) }
    end

    # ---------------------------------------------------------------- vertical
    # Ornamental pickets, wood boards and pickets, vinyl boards and pickets.
    def vertical
      s = @s
      h = f('height', 72)
      c = @clear
      pw = f('picket_w', 0.75)
      pd = f('picket_d', 0.75)
      air = f('air_space', 3.625)
      rw = f('rail_w', 1.75)
      rh = f('rail_h', 1.75)
      lat = f('lattice_h', 0)
      lat = 0 if lat < rh * 3
      main_top = h - lat
      top_ext = (s['top'] == 'extended' && lat <= 0) ? f('top_ext') : 0.0
      bot_ext = s['bottom'] == 'extended' ? f('bottom_ext') : 0.0
      top_rail_top = main_top - top_ext
      bot_rail_bot = c + bot_ext
      n_rails = [s['rails'].to_i, 2].max
      back = s['rail_mount'] == 'back'
      ry0 = -rw / 2
      ry1 = rw / 2
      if back
        fy = [ry1, ry1 + pd]
        by = [ry0 - pd, ry0]
      else
        fy = [-pd / 2, pd / 2]
        by = fy
      end

      fs = @frame ? f('gate_frame', 1.75) : 0.0
      x_lo = fs
      x_hi = @w - fs

      # Rails
      step = n_rails > 1 ? (top_rail_top - rh - bot_rail_bot) / (n_rails - 1) : 0
      n_rails.times do |i|
        zb = bot_rail_bot + step * i
        rail(frame_mesh, x_lo, x_hi, zb, ry0, ry1, rh, i == n_rails - 1 && lat <= 0)
      end
      @stats[:rails] += n_rails
      @stats[:rail_len] += n_rails * (x_hi - x_lo)

      # Gate frame: stiles and optional diagonal brace
      if @frame
        [[0.0, fs], [@w - fs, @w]].each do |xa, xb|
          zt = top_rail_top + curve((xa + xb) / 2)
          Geo.abox(frame_mesh, xa, xb, ry0, ry1, g(xa) + bot_rail_bot, g(xa) + zt)
        end
        if on?('gate_brace')
          Geo.beam(frame_mesh, x_lo, g(x_lo) + bot_rail_bot + rh,
                   x_hi, g(x_hi) + top_rail_top - rh * 2.4, ry0, ry1, rh * 1.4)
        end
      end

      # Pickets / boards
      span = x_hi - x_lo
      fronts = layout(span, pw, air).map { |x| x + x_lo }
      backs = []
      if s['layout'] == 'shadowbox' && fronts.size > 1
        backs = (0...(fronts.size - 1)).map { |i| (fronts[i] + fronts[i + 1]) / 2 }
      end
      board_curve = lat > 0 ? ->(_x) { 0.0 } : ->(x) { curve(x) }
      kick = back && on?('kickboard') ? f('kick_h', 5.5) : 0.0
      if kick > 0
        Geo.beam(infill_mesh, x_lo, g(x_lo) + c, x_hi, g(x_hi) + c, ry1, ry1 + 1.5, kick)
        @stats[:kick_len] += x_hi - x_lo
      end
      fronts.each { |x| picket(x, pw, fy, g(x) + c + kick, g(x) + main_top + board_curve.call(x)) }
      backs.each { |x| picket(x, pw, by, g(x) + c + kick, g(x) + main_top + board_curve.call(x)) }
      @stats[:pickets] += fronts.size + backs.size
      @stats[:max_picket_len] = [@stats[:max_picket_len], main_top - c].max

      # Puppy pickets between the main pickets (ornamental option)
      if on?('puppy') && s['layout'] != 'shadowbox' && fronts.size > 1
        ph = f('puppy_h', 14)
        (0...(fronts.size - 1)).each do |i|
          x = (fronts[i] + fronts[i + 1]) / 2
          z0 = g(x) + c
          Geo.abox(infill_mesh, x - pw / 2, x + pw / 2, fy[0], fy[1], z0, z0 + ph)
          Geo.square_pyramid(infill_mesh, x, (fy[0] + fy[1]) / 2, z0 + ph, pw * 0.5, pw * 0.6)
          @stats[:puppy] += 1
        end
      end

      lattice(x_lo, x_hi, main_top, h, rw, rh, ry0, ry1) if lat > 0

      if on?('cap')
        cw = f('cap_w', 5.5)
        ct = f('cap_t', 1.5)
        ymid = back ? (ry0 + fy[1]) / 2 : 0.0
        Geo.beam(frame_mesh, 0, g(0) + h, @w, g(@w) + h, ymid - cw / 2, ymid + cw / 2, ct)
        @stats[:cap_len] += @w
        if on?('trim')
          Geo.beam(frame_mesh, 0, g(0) + h - 3.5, @w, g(@w) + h - 3.5, fy[1], fy[1] + 0.75, 3.5)
          @stats[:trim_len] += @w
        end
      end
    end

    def picket(xc, pw, yy, zb, zt)
      y0, y1 = yy
      x0 = xc - pw / 2
      x1 = xc + pw / 2
      mesh = infill_mesh
      ym = (y0 + y1) / 2
      dep = y1 - y0
      case @s['finial']
      when 'dogear'
        d = [pw * 0.18, 1.0].min
        Geo.prism_xz(mesh, [[x0, zb], [x1, zb], [x1, zt - d], [x1 - d, zt], [x0 + d, zt], [x0, zt - d]], y0, y1)
      when 'point'
        p = pw * 0.5
        Geo.prism_xz(mesh, [[x0, zb], [x1, zb], [x1, zt - p], [xc, zt], [x0, zt - p]], y0, y1)
      when 'gothic'
        p = pw * 0.9
        Geo.prism_xz(mesh, [[x0, zb], [x1, zb], [x1, zt - p], [x1 - pw * 0.1, zt - p * 0.5],
                            [xc + pw * 0.18, zt - p * 0.15], [xc, zt], [xc - pw * 0.18, zt - p * 0.15],
                            [x0 + pw * 0.1, zt - p * 0.5], [x0, zt - p]], y0, y1)
      when 'spear'
        Geo.abox(mesh, x0, x1, y0, y1, zb, zt)
        hx = pw * 0.65
        hy = dep * 0.65
        sh = [pw * 3.2, 2.0].max
        base = [[xc - hx, ym - hy, zt], [xc + hx, ym - hy, zt], [xc + hx, ym + hy, zt], [xc - hx, ym + hy, zt]]
        Geo.pyramid(mesh, base, [xc, ym, zt + sh])
        @stats[:finials] += 1
      when 'trident'
        Geo.abox(mesh, x0, x1, y0, y1, zb, zt)
        th = [pw * 1.6, 1.5].max
        [-1, 0, 1].each do |k|
          cx = xc + k * pw / 3
          hx = pw / 6
          base = [[cx - hx, y0, zt], [cx + hx, y0, zt], [cx + hx, y1, zt], [cx - hx, y1, zt]]
          Geo.pyramid(mesh, base, [cx, ym, zt + (k.zero? ? th * 1.4 : th)])
        end
        @stats[:finials] += 1
      when 'pyramid'
        Geo.abox(mesh, x0, x1, y0, y1, zb, zt)
        base = [[x0, y0, zt], [x1, y0, zt], [x1, y1, zt], [x0, y1, zt]]
        Geo.pyramid(mesh, base, [xc, ym, zt + pw * 0.6])
      when 'ball'
        Geo.abox(mesh, x0, x1, y0, y1, zb, zt)
        r = pw * 0.7
        Geo.ball(@ms[@imat, true], [xc, ym, zt + r * 0.85], r, 8, 5)
        @stats[:finials] += 1
      else
        Geo.abox(mesh, x0, x1, y0, y1, zb, zt)
      end
    end

    # Square lattice topper between a separator rail and a top rail.
    def lattice(x_lo, x_hi, z_bottom, z_top, rw, rh, ry0, ry1)
      rail(frame_mesh, x_lo, x_hi, z_bottom, ry0, ry1, rh)
      rail(frame_mesh, x_lo, x_hi, z_top - rh, ry0, ry1, rh, true)
      zl0 = z_bottom + rh
      zl1 = z_top - rh
      return if zl1 - zl0 < 1
      dip = curved? && @curve[:type] == 'concave' ? @curve[:h].to_f : 0.0
      t = [rw * 0.25, 0.4].min
      sw = 1.25
      pitch = 3.5
      mesh = infill_mesh
      x = x_lo + pitch / 2
      while x + sw / 2 < x_hi
        Geo.beam(mesh, x - sw / 2, g(x) + zl0, x + sw / 2, g(x) + zl0, -t - 0.01, -0.01, zl1 - zl0 + curve(x))
        x += pitch
      end
      z = zl0 + pitch / 2
      while z + sw / 2 < zl1 - dip
        Geo.beam(mesh, x_lo, g(x_lo) + z - sw / 2, x_hi, g(x_hi) + z - sw / 2, 0.01, t + 0.01, sw)
        z += pitch
      end
      @stats[:lattice_len] += x_hi - x_lo
    end

    # -------------------------------------------------------------- horizontal
    # Horizontal wood boards, split rail and ranch rail.
    def horizontal
      s = @s
      h = f('height', 48)
      c = @clear
      bh = f('board_h', 5.5)
      bt = f('board_t', 0.75)
      gap = f('board_gap', 0.5)
      cnt = s['h_count'].to_i
      mount = s['h_mount'] || 'face'
      post_half = f('post_size', 3.5) / 2
      rw = f('rail_w', 1.5)

      fs = @frame ? f('gate_frame', 3.5) : 0.0
      if @frame
        x0 = fs
        x1 = @w - fs
        y0 = -bt / 2
        y1 = bt / 2
        fy0 = mount == 'face' ? -bt / 2 - rw : -rw / 2
        fy1 = mount == 'face' ? -bt / 2 : rw / 2
      else
        case mount
        when 'face'
          x0 = -@ext_a
          x1 = @w + @ext_b
          y0 = post_half
          y1 = post_half + bt
        when 'through'
          x0 = -@ext_a
          x1 = @w + @ext_b
          y0 = -bt / 2
          y1 = bt / 2
        else
          x0 = 0.0
          x1 = @w
          y0 = -bt / 2
          y1 = bt / 2
        end
      end

      zs = []
      if cnt > 0
        top_b = h - bh
        bot_b = c + f('bottom_ext')
        if cnt == 1
          zs << top_b
        else
          (0...cnt).each { |i| zs << bot_b + (top_b - bot_b) * i / (cnt - 1) }
        end
      else
        z = h - bh
        while z >= c - 1e-6
          zs << z
          z -= bh + gap
        end
      end
      zs.each { |zb| rail(infill_mesh, x0, x1, zb, y0, y1, bh) }
      @stats[:boards] += zs.size
      @stats[:max_board_len] = [@stats[:max_board_len], x1 - x0].max

      if @frame
        zt = h
        zb = c
        [[0.0, fs], [@w - fs, @w]].each do |xa, xb|
          Geo.abox(frame_mesh, xa, xb, fy0, fy1, g(xa) + zb, g(xa) + zt)
        end
        if on?('gate_brace') || mount == 'face'
          rail(frame_mesh, x0, x1, zb, fy0, fy1, 3.5)
          rail(frame_mesh, x0, x1, zt - 3.5, fy0, fy1, 3.5)
          Geo.beam(frame_mesh, x0, g(x0) + zb + 3.5, x1, g(x1) + zt - 3.5 * 2.4, fy0, fy1, 3.5 * 1.4)
        end
      end

      if on?('cap')
        cw = f('cap_w', 5.5)
        ct = f('cap_t', 1.5)
        ymid = mount == 'face' && !@frame ? (post_half + bt) / 2 : 0.0
        Geo.beam(frame_mesh, x0, g(x0) + h, x1, g(x1) + h, ymid - cw / 2, ymid + cw / 2, ct)
        @stats[:cap_len] += x1 - x0
      end
    end

    # -------------------------------------------------------------- chain link
    def chain_link
      h = f('height', 72)
      c = @clear
      r = f('rail_od', 1.66) / 2
      pipe = @ms[nil, true]
      fab = @ms[@imat]
      ft = 0.12

      if @frame
        fr = f('gate_frame', 1.9) / 2
        xa = fr
        xb = @w - fr
        Geo.cyl(pipe, [xa, 0, g(xa) + c], [xa, 0, g(xa) + h], fr)
        Geo.cyl(pipe, [xb, 0, g(xb) + c], [xb, 0, g(xb) + h], fr)
        [c + fr, h - fr, (c + h) / 2].each do |z|
          Geo.cyl(pipe, [xa + fr, 0, g(xa) + z], [xb - fr, 0, g(xb) + z], fr)
        end
        Geo.beam(fab, xa + fr, g(xa) + c + fr, xb - fr, g(xb) + c + fr, -ft / 2, ft / 2, h - c - 2 * fr)
        @stats[:fabric_len] += @w
        return
      end

      post_r = f('post_size', 2.375) / 2
      fy0 = post_r
      fy1 = post_r + ft
      x0 = -@ext_a
      x1 = @w + @ext_b
      Geo.cyl(pipe, [0, 0, g(0) + h - r], [@w, 0, g(@w) + h - r], r)
      rails = 1
      if on?('mid_rail')
        zm = c + (h - c) / 2
        Geo.cyl(pipe, [0, 0, g(0) + zm], [@w, 0, g(@w) + zm], r)
        rails += 1
      end
      if on?('bottom_rail')
        Geo.cyl(pipe, [0, 0, g(0) + c + r], [@w, 0, g(@w) + c + r], r)
        rails += 1
      else
        Geo.cyl(pipe, [x0, fy0, g(x0) + c + 1], [x1, fy0, g(x1) + c + 1], 0.1, 4)
        @stats[:tension_wire] += x1 - x0
      end
      @stats[:rails] += rails
      @stats[:rail_len] += rails * (x1 - x0)
      Geo.beam(fab, x0, g(x0) + c, x1, g(x1) + c, fy0, fy1, h - c)
      @stats[:fabric_len] += x1 - x0

      n = f('barbed', 0).to_i
      n.times do |k|
        d = 3.0 * (k + 1)
        Geo.cyl(@ms[@hmat, true], [x0, d * 0.7071, g(x0) + h + 2 + d * 0.7071],
                [x1, d * 0.7071, g(x1) + h + 2 + d * 0.7071], 0.08, 4, false)
      end
      @stats[:barbed_len] += n * (x1 - x0)
    end
  end
end
