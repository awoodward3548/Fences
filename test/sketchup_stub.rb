# Minimal stand-in for the parts of the SketchUp Ruby API that Fence Builder
# uses, so the geometry code can be exercised (and exported to OBJ) outside
# SketchUp. Not a full emulation.
require 'json'

module Geom
  class Point3d
    attr_accessor :x, :y, :z
    def initialize(x = 0, y = 0, z = 0)
      @x, @y, @z = x.to_f, y.to_f, z.to_f
    end

    def to_a
      [@x, @y, @z]
    end

    def transform(tr)
      tr.apply(self)
    end
  end

  class Vector3d < Point3d; end

  class Transformation
    attr_reader :m # row-major 4x4

    def initialize(m = nil)
      @m = m || [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]].map { |r| r.map(&:to_f) }
    end

    def self.axes(o, x, y, z)
      new([[x.x, y.x, z.x, o.x], [x.y, y.y, z.y, o.y], [x.z, y.z, z.z, o.z], [0, 0, 0, 1]].map { |r| r.map(&:to_f) })
    end

    def self.translation(v)
      new([[1, 0, 0, v.x], [0, 1, 0, v.y], [0, 0, 1, v.z], [0, 0, 0, 1]].map { |r| r.map(&:to_f) })
    end

    def self.rotation(pt, axis, ang)
      raise 'only z rotation stubbed' unless axis.x.zero? && axis.y.zero?
      c = Math.cos(ang)
      s = Math.sin(ang)
      t1 = translation(Vector3d.new(pt.x, pt.y, pt.z))
      r = new([[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
      t2 = translation(Vector3d.new(-pt.x, -pt.y, -pt.z))
      t1 * r * t2
    end

    def *(other)
      a = @m
      b = other.m
      Transformation.new(Array.new(4) { |i| Array.new(4) { |j| (0..3).inject(0.0) { |s, k| s + a[i][k] * b[k][j] } } })
    end

    def apply(p)
      v = [p.x, p.y, p.z, 1.0]
      r = @m.map { |row| row.each_with_index.inject(0.0) { |s, (e, i)| s + e * v[i] } }
      Point3d.new(r[0], r[1], r[2])
    end
  end

  class PolygonMesh
    attr_reader :points, :polygons
    def initialize(*)
      @points = []
      @polygons = []
    end

    def add_polygon(*pts)
      pts = pts.first if pts.size == 1 && pts.first.is_a?(Array)
      @polygons << pts.map { |p| @points << p; @points.size }
      @polygons.size
    end

    def count_polygons
      @polygons.size
    end
  end
end

module Sketchup
  class Color
    attr_reader :rgb
    def initialize(*rgb)
      @rgb = rgb
    end
  end

  class Material
    attr_accessor :name, :color, :alpha
    def initialize(name)
      @name = name
      @alpha = 1.0
    end
  end

  class Materials
    include Enumerable
    def initialize
      @list = {}
    end

    def [](n)
      @list[n]
    end

    def add(n)
      @list[n] = Material.new(n)
    end

    def each(&b)
      @list.values.each(&b)
    end
  end

  class Layer
    attr_accessor :name, :color
    def initialize(n)
      @name = n
    end
  end

  class Layers
    def initialize
      @list = [Layer.new('Layer0')]
    end

    def [](k)
      k.is_a?(Integer) ? @list[k] : @list.find { |l| l.name == k }
    end

    def add(n)
      self[n] || (@list << Layer.new(n)).last
    end
  end

  module Attr
    def attribute_dictionary(d)
      (@attrs ||= {})[d]
    end

    def set_attribute(d, k, v)
      ((@attrs ||= {})[d] ||= {})[k] = v
    end

    def get_attribute(d, k, default = nil)
      h = (@attrs ||= {})[d]
      h && h.key?(k) ? h[k] : default
    end

    def delete_attribute(d, k = nil)
      k ? ((@attrs || {})[d] || {}).delete(k) : (@attrs || {}).delete(d)
    end
  end

  class Entities
    include Enumerable
    attr_reader :list, :meshes, :parent
    def initialize(parent)
      @parent = parent
      @list = []
      @meshes = []
    end

    def add_group
      g = Group.new(@parent)
      @list << g
      g
    end

    def add_faces_from_mesh(mesh, flags = 0, fm = nil, _bm = nil)
      @meshes << [mesh, flags, fm]
    end

    def each(&b)
      @list.each(&b)
    end

    def length
      @list.size + @meshes.size
    end

    def clear!
      @list.clear
      @meshes.clear
    end

    def grep(cls)
      @list.grep(cls)
    end
  end

  class Drawingelement
    include Attr
    attr_accessor :layer, :material, :name
  end

  class Group < Drawingelement
    attr_accessor :transformation
    attr_reader :entities, :parent
    def initialize(parent)
      @parent = parent
      @entities = Entities.new(self)
      @transformation = Geom::Transformation.new
      @valid = true
    end

    def definition
      self
    end

    def erase!
      @parent.entities.list.delete(self)
      @valid = false
    end

    def valid?
      @valid
    end

    def make_unique
      self
    end
  end

  class ComponentInstance < Group; end
  class ComponentDefinition; end

  class Vertex
    attr_reader :position
    def initialize(p)
      @position = Geom::Point3d.new(*p)
    end
  end

  class Edge < Drawingelement
    attr_reader :start, :end, :parent
    def initialize(parent, a, b)
      @parent = parent
      @start = Vertex.new(a)
      @end = Vertex.new(b)
      @layer = nil
    end
  end

  class Model
    include Attr
    attr_reader :materials, :layers, :entities
    def initialize
      @materials = Materials.new
      @layers = Layers.new
      @entities = Entities.new(self)
    end

    def active_entities
      @entities
    end

    def start_operation(*); end
    def commit_operation; end
    def abort_operation; end
  end

  class SelectionObserver; end

  def self.require(path)
    Kernel.require(path)
  end

  def self.active_model
    @model ||= Model.new
  end
end

def file_loaded?(*)
  true
end

def file_loaded(*); end
