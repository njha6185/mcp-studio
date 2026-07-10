interface Props {
  text: string;
  /** Which side the bubble opens toward. Default: bottom-right of the icon. */
  pos?: "bottom" | "bottom-left" | "right";
}

/** Small ⓘ icon that reveals an explanation on hover or keyboard focus. */
export default function InfoTip({ text, pos = "bottom" }: Props) {
  return (
    <span className={`infotip infotip-${pos}`} tabIndex={0} role="note" aria-label={text}>
      <span className="infotip-icon" aria-hidden="true">
        i
      </span>
      <span className="infotip-bubble">{text}</span>
    </span>
  );
}
