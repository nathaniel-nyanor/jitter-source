export type LayerType =
    | 'text'
    | 'rectangle'
    | 'ellipse'
    | 'image'
    | 'frame'
    | 'group';

export type AnimatedProperty =
    | 'x'
    | 'y'
    | 'width'
    | 'height'
    | 'scale'
    | 'rotation'
    | 'opacity'
    | 'blur';

export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export type AnimationActionPhase = 'in' | 'custom' | 'out';

export type AnimationActionKind =
    | 'fade'
    | 'slide'
    | 'move'
    | 'scale'
    | 'rotate'
    | 'opacity'
    | 'color'
    | 'blur'
    | 'resize'
    | 'pop'
    | 'spin'
    | 'float'
    | 'pulse'
    | 'shake'
    | 'jiggle'
    | 'blink'
    | 'bounce'
    | 'click';

export interface Transform {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    scale: number;
    opacity: number;
    blur?: number;
}

export interface Layer {
    id: string;
    type: LayerType;
    name: string;
    content?: string;
    fill: string;
    fontSize?: number;
    fontWeight?: number;
    parentId?: string;
    transform: Transform;
    hidden: boolean;
    locked: boolean;
}

export interface AnimationAction {
    id: string;
    layerId: string;
    name: string;
    kind: AnimationActionKind;
    phase: AnimationActionPhase;
    startMs: number;
    durationMs: number;
    easing: Easing;
    delta: Partial<Record<AnimatedProperty, number>>;
    color?: string;
    scope?: 'layer' | 'line' | 'word' | 'character';
    order?: 'forward' | 'reverse';
    staggerMs?: number;
    smoothing?: Easing;
}

export interface Composition {
    version: string;
    name: string;
    width: number;
    height: number;
    durationMs: number;
    background: string;
    layers: Layer[];
    actions: AnimationAction[];
}

export interface ProjectSummary {
    id: string;
    name: string;
    width: number;
    height: number;
    durationMs: number;
    thumbnailPath: string | null;
    updatedAt: string | null;
}

export interface ArtboardPreset {
    id: string;
    name: string;
    width: number;
    height: number;
    category: string;
}

export interface EditorProject extends ProjectSummary {
    composition: Composition;
}
