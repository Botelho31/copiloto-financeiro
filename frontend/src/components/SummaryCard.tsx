export function SummaryCard(props: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "good" | "bad";
  caption?: string;
}) {
  return (
    <div className={`summary-card${props.tone ? ` ${props.tone}` : ""}`}>
      <div className="label">{props.label}</div>
      <div className="value">{props.value}</div>
      {props.caption && <div className="caption">{props.caption}</div>}
    </div>
  );
}
