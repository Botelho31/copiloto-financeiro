import { useTranslation } from "react-i18next";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import { FALLBACK_CATEGORY_COLOR, PIE_LABEL_MIN_PERCENT } from "../../config";
import { moneyTooltip } from "../../lib/format";

// Recharts 3's Pie doesn't type activeIndex/activeShape, so growth (on
// hover OR selection) is done via a custom shape renderer instead. The
// outerRadius itself is left alone — animating a Sector's raw `d` path via
// CSS doesn't interpolate — and instead a <g> wrapper is scaled up with a
// CSS transform (a property browsers actually animate smoothly), anchored
// on the pie's own center so it grows in place rather than drifting.
function makePieShape(baseOuterRadius: number, isActive: (name: string) => boolean) {
  return (props: any) => (
    <g
      style={{
        transform: isActive(props.name) ? "scale(1.08)" : "scale(1)",
        transformOrigin: `${props.cx}px ${props.cy}px`,
        transition: "transform 180ms ease",
      }}
    >
      <Sector {...props} outerRadius={baseOuterRadius} />
    </g>
  );
}

function makePieLabel(
  onSelect: (name: string) => void,
  onHoverChange: (name: string | null) => void
) {
  return (props: any) => {
    const { cx, cy, midAngle, outerRadius, percent, name } = props;
    if (!name || percent < PIE_LABEL_MIN_PERCENT) return null;
    const RADIAN = Math.PI / 180;
    const radius = outerRadius + 14;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text
        x={x}
        y={y}
        textAnchor={x > cx ? "start" : "end"}
        dominantBaseline="central"
        fill="var(--text-muted)"
        fontSize={12}
        style={{ cursor: "pointer" }}
        onClick={() => onSelect(name)}
        onMouseEnter={() => onHoverChange(name)}
        onMouseLeave={() => onHoverChange(null)}
      >
        {name}
      </text>
    );
  };
}

// Deliberately unboxed — the bordered squares that used to frame each pie
// were removed at the user's explicit request; the two charts are paired by
// a shared hairline divider in the section that renders them instead.
export function CategoryPie(props: {
  data: { name: string; value: number }[];
  type: "CREDIT" | "DEBIT";
  drilldown: { type: "CREDIT" | "DEBIT"; category: string } | null;
  onSelect: (type: "CREDIT" | "DEBIT", category: string | null) => void;
  hoveredCategory: { type: "CREDIT" | "DEBIT"; category: string | null } | null;
  onHoverChange: (v: { type: "CREDIT" | "DEBIT"; category: string | null } | null) => void;
  categoryColorByName: Map<string, string>;
}) {
  const { t } = useTranslation("dashboard");

  function toggle(name: string) {
    props.onSelect(
      props.type,
      props.drilldown?.type === props.type && props.drilldown.category === name ? null : name
    );
  }

  function isActive(name: string) {
    return (
      (props.drilldown?.type === props.type && props.drilldown.category === name) ||
      (props.hoveredCategory?.type === props.type && props.hoveredCategory.category === name)
    );
  }

  if (props.data.length === 0) {
    return (
      <div
        style={{
          aspectRatio: "1 / 1",
          maxWidth: 420,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p className="muted">{t("chart.pieEmpty")}</p>
      </div>
    );
  }

  return (
    <div
      style={{
        aspectRatio: "1 / 1",
        maxWidth: 420,
        margin: "0 auto",
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 24, right: 24, bottom: 24, left: 24 }}>
          <Pie
            data={props.data}
            dataKey="value"
            nameKey="name"
            innerRadius={65}
            outerRadius={100}
            paddingAngle={1}
            labelLine={false}
            shape={makePieShape(100, isActive)}
            label={makePieLabel(toggle, (name) =>
              props.onHoverChange(name ? { type: props.type, category: name } : null)
            )}
            isAnimationActive={false}
            cursor="pointer"
            onMouseEnter={(entry: any) => {
              const name = entry?.name ?? entry?.payload?.name;
              if (name) props.onHoverChange({ type: props.type, category: name });
            }}
            onMouseLeave={() => props.onHoverChange(null)}
            onClick={(entry: any) => {
              const name = entry?.name ?? entry?.payload?.name;
              if (name) toggle(name);
            }}
          >
            {props.data.map((entry) => {
              const selected = isActive(entry.name);
              return (
                <Cell
                  key={entry.name}
                  fill={props.categoryColorByName.get(entry.name) ?? FALLBACK_CATEGORY_COLOR}
                  stroke={selected ? "var(--paper)" : "none"}
                  strokeWidth={selected ? 1.5 : 0}
                />
              );
            })}
          </Pie>
          <Tooltip formatter={moneyTooltip} />
          <Legend
            iconType="circle"
            iconSize={9}
            // Recharts' default legend paints each label in its series color,
            // which goes murky against the dark ink — let the circle swatch
            // carry identity (same dot pattern as the category chips
            // elsewhere) and keep the text in text tokens, brightening the
            // hovered/selected entry to mirror the slice growing.
            formatter={(value: any) => (
              <span
                style={{
                  color: isActive(String(value)) ? "var(--paper)" : "var(--text-muted)",
                  fontSize: 13,
                }}
              >
                {value}
              </span>
            )}
            onClick={(entry: any) => entry?.value && toggle(entry.value)}
            onMouseEnter={(entry: any) =>
              entry?.value && props.onHoverChange({ type: props.type, category: entry.value })
            }
            onMouseLeave={() => props.onHoverChange(null)}
            wrapperStyle={{ cursor: "pointer" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
