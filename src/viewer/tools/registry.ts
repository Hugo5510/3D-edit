import type { Tool, Viewer } from '../Viewer';
import type { SketchLayer } from '../SketchLayer';
import type { ToolId } from '../../state/store';
import { SelectTool } from './SelectTool';

export const toolFactories: Partial<Record<ToolId, (v: Viewer, sl: SketchLayer) => Tool>> = {
  select: (v) => new SelectTool(v),
};
