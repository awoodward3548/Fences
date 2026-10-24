module FenceBuilder
  # Turns the edges of a path (a group, component or loose edges) into ordered
  # chains of points. Edges marked as gates (via the "Mark gate" command or a
  # tag whose name contains "gate") carry their gate options along.
  #
  # Chain format (JSON friendly, stored on the fence for rebuilds):
  #   { 'pts' => [[x,y,z], ...], 'gates' => [nil | {gate opts}, ...],
  #     'closed' => bool, 'deg' => [first_vertex_degree, last_vertex_degree] }
  module PathParser
    DICT = 'FenceBuilder'.freeze
    PREC = 100.0 # merge vertices closer than 0.01"

    module_function

    def path_entity?(e)
      return false unless e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
      return false if FenceBuilder.fence?(e)
      definition(e).entities.any? { |x| x.is_a?(Sketchup::Edge) }
    end

    def definition(e)
      e.respond_to?(:definition) ? e.definition : e.entities.parent
    end

    def gate_opts(edge)
      d = edge.attribute_dictionary(DICT)
      layer_gate = edge.layer && edge.layer.name =~ /gate/i
      return nil unless (d && d['gate']) || layer_gate
      opts = {}
      if d
        d.each_pair { |k, v| opts[k] = v if k.start_with?('gate_') }
      end
      opts
    end

    # Chains from a group/component (in its parent's coordinates).
    def from_entity(ent)
      tr = ent.transformation
      edges = definition(ent).entities.grep(Sketchup::Edge)
      segs = edges.map do |e|
        a = e.start.position.transform(tr)
        b = e.end.position.transform(tr)
        [a.to_a, b.to_a, gate_opts(e)]
      end
      chains(segs)
    end

    # Chains from loose edges (in the active context).
    def from_edges(edges)
      segs = edges.map { |e| [e.start.position.to_a, e.end.position.to_a, gate_opts(e)] }
      chains(segs)
    end

    def key(p)
      [(p[0] * PREC).round, (p[1] * PREC).round, (p[2] * PREC).round]
    end

    # segs: [[pt_a, pt_b, gate_opts_or_nil], ...]
    def chains(segs)
      pts = {}
      list = []
      segs.each do |a, b, g|
        ka = key(a)
        kb = key(b)
        next if ka == kb
        pts[ka] ||= a.map(&:to_f)
        pts[kb] ||= b.map(&:to_f)
        list << [ka, kb, g]
      end
      adj = Hash.new { |h, k| h[k] = [] }
      list.each_with_index do |(a, b, _), i|
        adj[a] << i
        adj[b] << i
      end
      used = Array.new(list.size, false)
      out = []

      walk = lambda do |start, first|
        keys = [start]
        gates = []
        cur = start
        si = first
        loop do
          used[si] = true
          a, b, g = list[si]
          nxt = a == cur ? b : a
          keys << nxt
          gates << g
          cur = nxt
          break if adj[cur].size != 2
          si = adj[cur].find { |j| !used[j] }
          break unless si
        end
        closed = keys.size > 2 && keys.first == keys.last
        out << {
          'pts' => keys.map { |k| pts[k] },
          'gates' => gates,
          'closed' => closed,
          'deg' => [adj[keys.first].size, adj[keys.last].size]
        }
      end

      # Open chains start at ends or junctions...
      adj.keys.select { |k| adj[k].size != 2 }.each do |k|
        adj[k].each { |si| walk.call(k, si) unless used[si] }
      end
      # ...anything left is a closed loop.
      list.each_index do |i|
        walk.call(list[i][0], i) unless used[i]
      end
      out
    end

    def total_length(chains)
      chains.inject(0.0) do |sum, c|
        p = c['pts']
        sum + (0...(p.size - 1)).inject(0.0) do |s, i|
          s + Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1])
        end
      end
    end
  end
end
