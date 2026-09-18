import map from './step-components-map.json';

export interface StepComponentDef {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  readonly reserved?: boolean;
}

/** Mapping of the 16 component bits. See step-components-map.json for sources. */
export const STEP_COMPONENTS: readonly StepComponentDef[] = map.components;

export const componentById = (id: string): StepComponentDef | undefined => STEP_COMPONENTS.find((c) => c.id === id);

/** Components are documented by TE only for audio tracks 1–8. */
export const COMPONENT_TRACK_LIMIT = 8;
