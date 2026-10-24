module FenceBuilder
  # Collects quantities while a fence is built and turns them into a bill of
  # materials (rows of category / item / qty / unit / notes).
  class Bom
    CONCRETE_BAGS = [['80 lb bag', 0.60], ['60 lb bag', 0.45], ['50 lb bag', 0.375]].freeze

    def initialize(s)
      @s = s
      @panels = Hash.new(0)
      @posts = Hash.new(0)
      @caps = Hash.new(0)
      @gates = []
      @hardware = Hash.new(0)
      @totals = Hash.new(0)
      @concrete_ft3 = 0.0
      @holes = 0
      @run_length = 0.0
      @gate_length = 0.0
    end

    def kind
      @s['kind']
    end

    def section_word
      kind == 'ornamental' ? 'Panel' : 'Section'
    end

    def add_run_length(len)
      @run_length += len
    end

    def panel(width, racked, rise, stats, cut)
      notes = []
      notes << (racked ? (rise.abs > 0.5 ? 'racked' : 'level') : 'stepped')
      notes << cut if cut
      key = [FenceBuilder.fmt_in(width), notes.join(', ')]
      @panels[key] += 1
      stats.each do |k, v|
        @totals[k] = k.to_s.start_with?('max_') ? [@totals[k], v].max : @totals[k] + v
      end
      @totals[:panel_count] += 1
    end

    def post(type, size, length, round)
      shape = round ? "#{FenceBuilder.fmt_in(size)} OD" : "#{FenceBuilder.fmt_in(size)} sq"
      @posts[[type, shape, length]] += 1
      cap = @s['post_cap']
      unless cap.nil? || cap == 'none'
        cap_name = round ? (type == 'line' ? 'Loop cap' : 'Dome cap') : "#{cap.tr('_', ' ').capitalize} cap"
        @caps[[cap_name, shape]] += 1
      end
    end

    def footing(dia, depth, post_size, round)
      hole = Math::PI * (dia / 2.0)**2 * depth
      post = round ? Math::PI * (post_size / 2.0)**2 * depth : post_size**2 * depth
      @concrete_ft3 += [hole - post, 0].max / 1728.0
      @holes += 1
    end

    def gate(info)
      @gates << info
      @gate_length += info[:opening]
    end

    def hardware(name, qty)
      @hardware[name] += qty
    end

    def summary
      {
        'length' => FenceBuilder.fmt_len(@run_length + @gate_length),
        'length_ft' => ((@run_length + @gate_length) / 12.0).round(1),
        'panels' => @totals[:panel_count],
        'posts' => @posts.values.inject(0, :+),
        'gates' => @gates.size
      }
    end

    def rows
      r = []
      add = lambda { |cat, item, qty, unit, note = ''| r << { 'cat' => cat, 'item' => item, 'qty' => qty, 'unit' => unit, 'note' => note } }
      s = @s
      h = FenceBuilder.num(s['height'])
      color = Catalog.color(s['color'])
      add.call('Summary', Catalog.style_label(s), 1, 'spec',
               "#{FenceBuilder.fmt_len(h)} high, #{color ? color['name'] : s['color']}")
      add.call('Summary', 'Fence length (incl. gates)', ((@run_length + @gate_length) / 12.0).round(1), 'ft',
               FenceBuilder.fmt_len(@run_length + @gate_length))
      add.call('Summary', 'Gate openings', (@gate_length / 12.0).round(1), 'ft', "#{@gates.size} gate(s)") if @gates.any?

      @panels.sort.each do |(w, note), q|
        add.call(section_word + 's', "#{section_word} #{FenceBuilder.fmt_len(h)} H x #{w} W", q, 'ea', note)
      end

      @posts.sort_by { |(t, sh, l), _| [t, sh, l] }.each do |(type, shape, len), q|
        add.call('Posts', "#{type.capitalize} post #{shape} x #{FenceBuilder.fmt_len(len)}", q, 'ea',
                 "includes #{FenceBuilder.fmt_in(FenceBuilder.num(s['embed_depth']))} embedment")
      end
      @caps.sort.each { |(name, shape), q| add.call('Posts', "#{name} (#{shape})", q, 'ea') }

      components(add)

      @gates.each do |g|
        add.call('Gates', g[:name], 1, 'ea', g[:note])
      end
      @hardware.sort.each { |name, q| add.call('Gate hardware', name, q, 'ea') }

      if @holes > 0
        yd3 = @concrete_ft3 / 27.0
        add.call('Concrete', "Post holes #{FenceBuilder.fmt_in(FenceBuilder.num(s['footing_dia']))} dia x " \
                             "#{FenceBuilder.fmt_in(FenceBuilder.num(s['embed_depth']))} deep", @holes, 'ea')
        add.call('Concrete', 'Concrete volume', yd3.round(2), 'yd3', "#{@concrete_ft3.round(1)} ft3")
        CONCRETE_BAGS.each do |name, ft3|
          add.call('Concrete', "Premix #{name}", (@concrete_ft3 / ft3).ceil, 'bags', "#{ft3} ft3 per bag (alternative)")
        end
      end
      r
    end

    private

    def components(add)
      t = @totals
      s = @s
      case s['infill']
      when 'chain_link'
        add.call('Chain link', 'Fabric', (t[:fabric_len] / 12.0).ceil, 'ft', "#{FenceBuilder.fmt_len(FenceBuilder.num(s['height']))} high")
        add.call('Chain link', "Rail #{FenceBuilder.fmt_in(FenceBuilder.num(s['rail_od']))} OD", (t[:rail_len] / 12.0).ceil, 'ft',
                 "#{(t[:rail_len] * 1.03 / (21 * 12)).ceil} sticks @ 21'")
        add.call('Chain link', 'Bottom tension wire', (t[:tension_wire] / 12.0).ceil, 'ft') if t[:tension_wire] > 0
        add.call('Chain link', 'Barbed wire', (t[:barbed_len] / 12.0).ceil, 'ft') if t[:barbed_len] > 0
        add.call('Chain link', 'Privacy slats', (t[:fabric_len] / 12.0).ceil, 'ft') if FenceBuilder.truthy?(s['slats'])
        terminals = @posts.select { |(type, _, _), _| type != 'line' }.values.inject(0, :+)
        lines = @posts.select { |(type, _, _), _| type == 'line' }.values.inject(0, :+)
        bands = [(FenceBuilder.num(s['height']) / 12.0).ceil - 1, 2].max
        add.call('Chain link', 'Tension bars', terminals * 2, 'ea', 'approx. 1 per fabric end')
        add.call('Chain link', 'Tension bands', terminals * 2 * bands, 'ea')
        add.call('Chain link', 'Brace bands + rail end cups', terminals * 2, 'ea')
        add.call('Chain link', 'Fence ties', lines * (FenceBuilder.num(s['height']) / 12.0).ceil + (t[:rail_len] / 24.0).ceil, 'ea',
                 'ties every 12" on posts and 24" on rails')
      when 'horizontal'
        add.call('Boards', "Boards/rails #{FenceBuilder.fmt_in(FenceBuilder.num(s['board_t']))} x #{FenceBuilder.fmt_in(FenceBuilder.num(s['board_h']))}",
                 t[:boards], 'ea', "approx. #{FenceBuilder.fmt_len(stock(t[:max_board_len]))} stock length")
        add.call('Boards', 'Cap board', (t[:cap_len] / 12.0).ceil, 'ft') if t[:cap_len] > 0
      else
        word = s['kind'] == 'ornamental' ? 'Pickets' : 'Boards / pickets'
        add.call('Components', "#{word} #{FenceBuilder.fmt_in(FenceBuilder.num(s['picket_w']))} x #{FenceBuilder.fmt_in(FenceBuilder.num(s['picket_d']))}",
                 t[:pickets], 'ea', "approx. #{FenceBuilder.fmt_len(t[:max_picket_len])} long")
        add.call('Components', 'Puppy pickets', t[:puppy], 'ea') if t[:puppy] > 0
        if s['kind'] == 'ornamental'
          add.call('Components', 'Rail-to-post brackets', t[:rails] * 2, 'ea', '2 per rail per panel')
        else
          add.call('Components', "Rails #{FenceBuilder.fmt_in(FenceBuilder.num(s['rail_w']))} x #{FenceBuilder.fmt_in(FenceBuilder.num(s['rail_h']))}",
                   t[:rails], 'ea', "#{(t[:rail_len] / 12.0).ceil} ft total")
        end
        add.call('Components', 'Cap board', (t[:cap_len] / 12.0).ceil, 'ft') if t[:cap_len] > 0
        add.call('Components', 'Trim board', (t[:trim_len] / 12.0).ceil, 'ft') if t[:trim_len] > 0
        add.call('Components', 'Lattice', (t[:lattice_len] / 12.0).ceil, 'ft') if t[:lattice_len] > 0
        if s['kind'] == 'wood' && t[:pickets] > 0
          add.call('Components', 'Fasteners (est.)', t[:pickets] * [s['rails'].to_i, 2].max * 2, 'ea', '2 per board per rail')
        end
      end
    end

    # Round a length up to standard 2' stock increments (min 8').
    def stock(len)
      ft = (len / 24.0).ceil * 2
      [ft, 8].max * 12
    end
  end
end
