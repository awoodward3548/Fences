module FenceBuilder
  # Low-level mesh helpers. Points are plain [x, y, z] arrays (inches) and are
  # converted to Geom::Point3d only when added to a PolygonMesh. Geometry is
  # batched into meshes so large fences build quickly.
  module Geo
    module_function

    def pt(a)
      Geom::Point3d.new(a[0].to_f, a[1].to_f, a[2].to_f)
    end

    def poly(mesh, pts)
      mesh.add_polygon(*pts.map { |p| pt(p) })
    end

    # Prism from a bottom and top quad, each counter-clockwise seen from above.
    def box(mesh, b, t)
      poly(mesh, b.reverse)
      poly(mesh, t)
      4.times do |i|
        j = (i + 1) % 4
        poly(mesh, [b[i], b[j], t[j], t[i]])
      end
    end

    # Axis-aligned box.
    def abox(mesh, x0, x1, y0, y1, z0, z1)
      return if x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4
      b = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]]
      t = b.map { |p| [p[0], p[1], z1] }
      box(mesh, b, t)
    end

    # Beam whose bottom edge runs from (x0, z0) to (x1, z1) with vertical end
    # cuts and a vertical thickness h. Used for racked rails and braces.
    def beam(mesh, x0, z0, x1, z1, y0, y1, h)
      return if (x1 - x0).abs < 1e-4 || h < 1e-4
      x0, z0, x1, z1 = x1, z1, x0, z0 if x1 < x0
      b = [[x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]]
      t = b.map { |p| [p[0], p[1], p[2] + h] }
      box(mesh, b, t)
    end

    # Extrude a profile drawn in the XZ plane (counter-clockwise as seen from
    # the front, i.e. from -Y) between y0 and y1.
    def prism_xz(mesh, prof, y0, y1)
      front = prof.map { |x, z| [x, y0, z] }
      back  = prof.map { |x, z| [x, y1, z] }
      poly(mesh, front)
      poly(mesh, back.reverse)
      n = prof.size
      n.times do |i|
        j = (i + 1) % n
        poly(mesh, [front[i], back[i], back[j], front[j]])
      end
    end

    # Pyramid on a base quad (counter-clockwise from above).
    def pyramid(mesh, base, apex)
      poly(mesh, base.reverse)
      4.times do |i|
        j = (i + 1) % 4
        poly(mesh, [base[i], base[j], apex])
      end
    end

    def square_pyramid(mesh, cx, cy, z, half, height)
      base = [[cx - half, cy - half, z], [cx + half, cy - half, z],
              [cx + half, cy + half, z], [cx - half, cy + half, z]]
      pyramid(mesh, base, [cx, cy, z + height])
    end

    def sub(a, b)
      [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
    end

    def add(a, b)
      [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
    end

    def scale(a, s)
      [a[0] * s, a[1] * s, a[2] * s]
    end

    def len(a)
      Math.sqrt(a[0]**2 + a[1]**2 + a[2]**2)
    end

    def norm(a)
      l = len(a)
      l < 1e-9 ? [0.0, 0.0, 0.0] : scale(a, 1.0 / l)
    end

    def cross(a, b)
      [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    end

    # Two unit vectors perpendicular to axis.
    def perp_axes(axis)
      ref = axis[2].abs < 0.9 ? [0, 0, 1] : [1, 0, 0]
      u = norm(cross(axis, ref))
      v = norm(cross(axis, u))
      [u, v]
    end

    # Closed n-sided cylinder (pipe) between two points.
    def cyl(mesh, p0, p1, r, n = 10, caps = true)
      axis = norm(sub(p1, p0))
      return if len(axis) < 1e-9
      u, v = perp_axes(axis)
      ring = lambda do |c|
        Array.new(n) do |i|
          a = 2 * Math::PI * i / n
          add(c, add(scale(u, r * Math.cos(a)), scale(v, r * Math.sin(a))))
        end
      end
      r0 = ring.call(p0)
      r1 = ring.call(p1)
      n.times do |i|
        j = (i + 1) % n
        poly(mesh, [r0[i], r0[j], r1[j], r1[i]])
      end
      return unless caps
      poly(mesh, r0.reverse)
      poly(mesh, r1)
    end

    # Low-poly sphere.
    def ball(mesh, c, r, seg = 10, rings = 6)
      grid = Array.new(rings + 1) do |i|
        phi = Math::PI * i / rings
        Array.new(seg) do |j|
          th = 2 * Math::PI * j / seg
          [c[0] + r * Math.sin(phi) * Math.cos(th),
           c[1] + r * Math.sin(phi) * Math.sin(th),
           c[2] + r * Math.cos(phi)]
        end
      end
      rings.times do |i|
        seg.times do |j|
          k = (j + 1) % seg
          a = grid[i][j]
          b = grid[i][k]
          cc = grid[i + 1][k]
          d = grid[i + 1][j]
          if i.zero?
            poly(mesh, [a, d, cc])
          elsif i == rings - 1
            poly(mesh, [a, d, b])
          else
            poly(mesh, [a, d, cc, b])
          end
        end
      end
    end

    # Upper half sphere (dome cap) sitting on z = c[2].
    def dome(mesh, c, r, seg = 10, rings = 3)
      grid = Array.new(rings + 1) do |i|
        phi = (Math::PI / 2) * i / rings
        Array.new(seg) do |j|
          th = 2 * Math::PI * j / seg
          [c[0] + r * Math.sin(phi) * Math.cos(th),
           c[1] + r * Math.sin(phi) * Math.sin(th),
           c[2] + r * Math.cos(phi)]
        end
      end
      rings.times do |i|
        seg.times do |j|
          k = (j + 1) % seg
          a = grid[i][j]
          b = grid[i][k]
          cc = grid[i + 1][k]
          d = grid[i + 1][j]
          i.zero? ? poly(mesh, [a, d, cc]) : poly(mesh, [a, d, cc, b])
        end
      end
      poly(mesh, grid[rings].reverse)
    end
  end

  # Groups meshes by material and smoothing so one panel/post can hold several
  # materials (e.g. a galvanized frame with green privacy slats).
  class MeshSet
    ROUND_FLAGS = 12 # AUTO_SOFTEN | SMOOTH_SOFT_EDGES

    def initialize
      @meshes = {}
    end

    def [](material = nil, round = false)
      @meshes[[material, round]] ||= Geom::PolygonMesh.new
    end

    def empty?
      @meshes.values.all? { |m| m.count_polygons.zero? }
    end

    def flush(entities)
      @meshes.each do |(mat, round), mesh|
        next if mesh.count_polygons.zero?
        entities.add_faces_from_mesh(mesh, round ? ROUND_FLAGS : 0, mat, mat)
      end
    end
  end
end
