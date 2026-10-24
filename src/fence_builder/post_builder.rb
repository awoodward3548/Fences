module FenceBuilder
  # Builds a single post (in post-local coordinates, ground at z = 0) with its
  # cap and, for chain link security fences, a barbed wire arm.
  module PostBuilder
    module_function

    # ms: MeshSet, s: settings, size: post width / OD, above: height above
    # grade to the top of the post body, type: line|end|corner|gate|support
    def build(ms, s, size, above, type, below = 0.0)
      h = size / 2.0
      mesh = ms[nil]
      if s['post_shape'] == 'round'
        Geo.cyl(ms[nil, true], [0, 0, -below], [0, 0, above], h, 12)
        round_cap(ms, s, h, above, type)
      else
        Geo.abox(mesh, -h, h, -h, h, -below, above)
        square_cap(ms, s, h, above)
      end
      barbed_arm(ms, s, h, above) if FenceBuilder.num(s['barbed']).to_i > 0
    end

    def square_cap(ms, s, h, z)
      mesh = ms[nil]
      case s['post_cap']
      when 'flat'
        o = [h * 0.08, 0.125].max
        Geo.abox(mesh, -h - o, h + o, -h - o, h + o, z, z + 0.375)
      when 'pyramid'
        o = [h * 0.08, 0.125].max
        Geo.abox(mesh, -h - o, h + o, -h - o, h + o, z, z + 0.25)
        Geo.square_pyramid(mesh, 0, 0, z + 0.25, h + o, h * 0.9)
      when 'ball'
        o = [h * 0.08, 0.125].max
        Geo.abox(mesh, -h - o, h + o, -h - o, h + o, z, z + 0.25)
        Geo.ball(ms[nil, true], [0, 0, z + 0.25 + h * 0.7], h * 0.75)
      when 'new_england'
        Geo.abox(mesh, -h - 0.5, h + 0.5, -h - 0.5, h + 0.5, z, z + 0.75)
        Geo.abox(mesh, -h - 0.25, h + 0.25, -h - 0.25, h + 0.25, z + 0.75, z + 1.5)
        Geo.square_pyramid(mesh, 0, 0, z + 1.5, h + 0.25, h * 0.45)
      when 'gothic'
        Geo.abox(mesh, -h - 0.25, h + 0.25, -h - 0.25, h + 0.25, z, z + 0.75)
        Geo.square_pyramid(mesh, 0, 0, z + 0.75, h + 0.25, h * 1.6)
      end
    end

    def round_cap(ms, s, r, z, type)
      return if s['post_cap'] == 'none'
      if type == 'line'
        # Loop cap: short collar the top rail passes through.
        Geo.cyl(ms[nil, true], [0, 0, z - 1.5], [0, 0, z + 0.25], r * 1.12, 12)
      else
        Geo.dome(ms[nil, true], [0, 0, z], r * 1.15, 12, 3)
      end
    end

    def barbed_arm(ms, s, h, z)
      len = 13.0
      a = 0.7071
      # The arm leans 45 degrees out over the +y face of the fence.
      Geo.cyl(ms[nil, true], [0, 0, z], [0, len * a, z + len * a], 0.6, 6)
    end

    # Concrete footing (in world coordinates) for the footings group.
    def footing(mesh, center, dia, depth)
      x, y, z = center
      Geo.cyl(mesh, [x, y, z - depth], [x, y, z], dia / 2.0, 16)
    end
  end
end
