module FenceBuilder
  DICT = 'FenceBuilder'.freeze

  module_function

  def fence?(e)
    (e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)) &&
      !e.get_attribute(DICT, 'settings').nil?
  end

  # Inches to a friendly feet-inches string, e.g. 76.5 -> 6' 4-1/2"
  def fmt_len(inches, denom = 8)
    neg = inches < 0
    total = (inches.abs * denom).round
    ft = total / (12 * denom)
    rem = total - ft * 12 * denom
    whole = rem / denom
    frac = rem % denom
    s = ''
    s << "#{ft}' " if ft > 0
    if frac > 0
      g = frac.gcd(denom)
      s << "#{whole}-#{frac / g}/#{denom / g}\""
    else
      s << "#{whole}\""
    end
    s = s.strip
    neg ? "-#{s}" : s
  end

  def fmt_in(inches, denom = 8)
    total = (inches.abs * denom).round
    whole = total / denom
    frac = total % denom
    return "#{whole}\"" if frac.zero?
    g = frac.gcd(denom)
    whole > 0 ? "#{whole}-#{frac / g}/#{denom / g}\"" : "#{frac / g}/#{denom / g}\""
  end

  def num(v, default = 0.0)
    return default if v.nil? || v == ''
    Float(v)
  rescue ArgumentError, TypeError
    default
  end

  def truthy?(v)
    v == true || v == 'true' || v == 1 || v == '1'
  end
end
