import { colorManipulator, GrafanaTheme2 } from '@grafana/data';

// Named colours from the Grafana palette, picked so that each keeps a contrast of at least 3:1 against the page
// background in both the light and the dark theme. Red is left out because it marks errors, and yellow because it
// is nearly invisible on white.
const AGENT_COLOR_NAMES = ['blue', 'dark-orange', 'semi-dark-green', 'purple', 'light-blue'];

export interface AgentColor {
  /** For the rail. */
  solid: string;
  /** Translucent fill for the owner chip, so the text on it keeps the theme's text colour. */
  tint: string;
}

export function getAgentColors(theme: GrafanaTheme2): AgentColor[] {
  return AGENT_COLOR_NAMES.map((name) => {
    const solid = theme.visualization.getColorByName(name);
    return { solid, tint: colorManipulator.alpha(solid, 0.18) };
  });
}

/** Agents beyond the palette reuse its colours in order. */
export function pickAgentColor(colors: AgentColor[], colorIndex: number): AgentColor {
  return colors[colorIndex % colors.length];
}
