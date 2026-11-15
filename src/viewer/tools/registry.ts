import type { Tool, Viewer } from '../Viewer';
import type { SketchLayer } from '../SketchLayer';
import type { ToolId } from '../../state/store';
import { SelectTool } from './SelectTool';
import { Arc3Tool, ArcCenterTool, CircleTool, FillTool, LineTool, PolygonTool, RectTool, SketchFilletTool } from './SketchTools';
import { EraseTool, ExtrudeTool, SketchPlaneTool } from './ModelTools';
import { BooleanTool, FilletTool, HoleTool, MeasureTool } from './FeatureTools';

export const toolFactories: Partial<Record<ToolId, (v: Viewer, sl: SketchLayer) => Tool>> = {
  select: (v, l) => new SelectTool(v, l),
  sketchPlane: (v) => new SketchPlaneTool(v),
  line: (v, l) => new LineTool(v, l),
  rect: (v, l) => new RectTool(v, l),
  circle: (v, l) => new CircleTool(v, l),
  polygon: (v, l) => new PolygonTool(v, l),
  arc3: (v, l) => new Arc3Tool(v, l),
  arcc: (v, l) => new ArcCenterTool(v, l),
  sketchFillet: (v, l) => new SketchFilletTool(v, l),
  fill: (v, l) => new FillTool(v, l),
  extrude: (v, l) => new ExtrudeTool(v, l),
  erase: (v) => new EraseTool(v),
  hole: (v) => new HoleTool(v),
  boolean: (v) => new BooleanTool(v),
  fillet: (v) => new FilletTool(v, 'fillet'),
  chamfer: (v) => new FilletTool(v, 'chamfer'),
  measure: (v) => new MeasureTool(v),
};
