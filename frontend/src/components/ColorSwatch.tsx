export function ColorSwatch(props: { color: string; size?: number }) {
  const size = props.size ?? 10;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: props.color,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}
