// Panele kolejnych narzędzi (otwór, zaokrąglenie, operacje logiczne, pomiar) – rejestrowane tutaj.
import type { ToolId } from '../state/store';

export const toolPanels: Partial<Record<ToolId, () => React.ReactNode>> = {};
