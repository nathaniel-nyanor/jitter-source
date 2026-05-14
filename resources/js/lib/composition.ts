import type {
    AnimatedProperty,
    AnimationAction,
    AnimationActionKind,
    AnimationActionPhase,
    Composition,
    Easing,
    Layer,
    LayerType,
    Transform,
} from '@/types';

const defaultTransform: Transform = {
    x: 120,
    y: 120,
    width: 320,
    height: 180,
    rotation: 0,
    scale: 1,
    opacity: 1,
    blur: 0,
};

export function createLayer(type: LayerType, index: number): Layer {
    const id = makeId('layer');
    const baseTransform = {
        ...defaultTransform,
        x: 120 + index * 28,
        y: 120 + index * 28,
    };

    if (type === 'text') {
        return {
            id,
            type,
            name: `Text ${index}`,
            content: 'New text',
            fill: '#111827',
            fontSize: 64,
            fontWeight: 700,
            transform: { ...baseTransform, height: 92 },
            hidden: false,
            locked: false,
        };
    }

    if (type === 'image') {
        return {
            id,
            type,
            name: `Image ${index}`,
            content: '',
            fill: '#dbeafe',
            transform: baseTransform,
            hidden: false,
            locked: false,
        };
    }

    if (type === 'frame') {
        return {
            id,
            type,
            name: `Frame ${index}`,
            fill: '#ffffff00',
            transform: { ...baseTransform, width: 420, height: 280 },
            hidden: false,
            locked: false,
        };
    }

    if (type === 'group') {
        return {
            id,
            type,
            name: `Group ${index}`,
            fill: '#ffffff00',
            transform: { ...baseTransform, width: 360, height: 240 },
            hidden: false,
            locked: false,
        };
    }

    return {
        id,
        type,
        name: type === 'ellipse' ? `Ellipse ${index}` : `Rectangle ${index}`,
        fill: type === 'ellipse' ? '#2563eb' : '#16a34a',
        transform: baseTransform,
        hidden: false,
        locked: false,
    };
}

export function layerWithActionsAtTime(
    layer: Layer,
    actions: AnimationAction[] = [],
    timeMs: number,
): Layer {
    const transform = { ...layer.transform };
    let fill = layer.fill;

    actions
        .filter((action) => action.layerId === layer.id)
        .forEach((action) => {
            const progress = actionProgress(action, timeMs);

            if (progress === null) {
                return;
            }

            const eased = ease(progress, action.easing);
            const multiplier = actionMultiplier(action, progress, eased);

            (
                Object.entries(action.delta) as Array<
                    [AnimatedProperty, number]
                >
            ).forEach(([property, delta]) => {
                transform[property] =
                    (transform[property] ?? 0) + delta * multiplier;
            });

            if (action.color) {
                fill = colorAtProgress(
                    fill,
                    action.color,
                    colorProgress(action, progress, eased, multiplier),
                    action.phase,
                );
            }
        });

    transform.opacity = Math.min(1, Math.max(0, transform.opacity));
    transform.scale = Math.max(0.01, transform.scale);
    transform.width = Math.max(1, transform.width);
    transform.height = Math.max(1, transform.height);
    transform.blur = Math.max(0, transform.blur ?? 0);

    return { ...layer, fill, transform };
}

export function addPreset(
    composition: Composition,
    layerId: string,
    preset: AnimationActionKind,
    phase: AnimationActionPhase = 'in',
): Composition {
    const layer = composition.layers.find((item) => item.id === layerId);

    if (!layer) {
        return composition;
    }

    const action = createAction(layerId, preset, phase);

    return {
        ...composition,
        actions: [...composition.actions, action],
    };
}

export function updateLayer(
    composition: Composition,
    layerId: string,
    updater: (layer: Layer) => Layer,
): Composition {
    return {
        ...composition,
        layers: composition.layers.map((layer) =>
            layer.id === layerId ? updater(layer) : layer,
        ),
    };
}

export function moveLayer(
    composition: Composition,
    layerId: string,
    direction: 'up' | 'down',
): Composition {
    const index = composition.layers.findIndex((layer) => layer.id === layerId);
    const targetIndex = direction === 'up' ? index + 1 : index - 1;

    if (
        index < 0 ||
        targetIndex < 0 ||
        targetIndex >= composition.layers.length
    ) {
        return composition;
    }

    const layers = [...composition.layers];
    const [layer] = layers.splice(index, 1);
    layers.splice(targetIndex, 0, layer);

    return { ...composition, layers };
}

export function duplicateLayer(
    composition: Composition,
    layerId: string,
): { composition: Composition; layerId: string } {
    const layer = composition.layers.find((item) => item.id === layerId);

    if (!layer) {
        return { composition, layerId };
    }

    const duplicatedLayerId = makeId('layer');
    const duplicatedLayer = {
        ...structuredClone(layer),
        id: duplicatedLayerId,
        name: `${layer.name} Copy`,
        transform: {
            ...layer.transform,
            x: layer.transform.x + 32,
            y: layer.transform.y + 32,
        },
    };

    return {
        layerId: duplicatedLayerId,
        composition: {
            ...composition,
            layers: [...composition.layers, duplicatedLayer],
            actions: [
                ...composition.actions,
                ...composition.actions
                    .filter((action) => action.layerId === layerId)
                    .map((action, actionIndex) => ({
                        ...structuredClone(action),
                        id: `${makeId('action')}-${action.kind}-${actionIndex}`,
                        layerId: duplicatedLayerId,
                    })),
            ],
        },
    };
}

export function deleteLayer(
    composition: Composition,
    layerId: string,
): Composition {
    return {
        ...composition,
        layers: composition.layers
            .filter((layer) => layer.id !== layerId)
            .map((layer) =>
                layer.parentId === layerId
                    ? { ...layer, parentId: undefined }
                    : layer,
            ),
        actions: composition.actions.filter(
            (action) => action.layerId !== layerId,
        ),
    };
}

export function groupLayer(
    composition: Composition,
    layerId: string,
): { composition: Composition; layerId: string } {
    const layer = composition.layers.find((item) => item.id === layerId);

    if (!layer || layer.type === 'group') {
        return { composition, layerId };
    }

    const groupId = makeId('layer');
    const padding = 32;
    const group: Layer = {
        id: groupId,
        type: 'group',
        name: `${layer.name} Group`,
        fill: '#ffffff00',
        transform: {
            x: layer.transform.x - padding,
            y: layer.transform.y - padding,
            width: layer.transform.width + padding * 2,
            height: layer.transform.height + padding * 2,
            rotation: 0,
            scale: 1,
            opacity: 1,
            blur: 0,
        },
        hidden: false,
        locked: false,
    };

    const index = composition.layers.findIndex((item) => item.id === layerId);
    const layers = [...composition.layers];
    layers.splice(index, 0, group);

    return {
        layerId: groupId,
        composition: {
            ...composition,
            layers: layers.map((item) =>
                item.id === layerId ? { ...item, parentId: groupId } : item,
            ),
        },
    };
}

export function updateAction(
    composition: Composition,
    actionId: string,
    updater: (action: AnimationAction) => AnimationAction,
): Composition {
    return {
        ...composition,
        actions: composition.actions.map((action) =>
            action.id === actionId ? updater(action) : action,
        ),
    };
}

export function deleteAction(
    composition: Composition,
    actionId: string,
): Composition {
    return {
        ...composition,
        actions: composition.actions.filter((action) => action.id !== actionId),
    };
}

export function createAction(
    layerId: string,
    kind: AnimationActionKind,
    phase: AnimationActionPhase,
): AnimationAction {
    const presets: Record<
        AnimationActionKind,
        {
            name: string;
            durationMs: number;
            delta: Partial<Record<AnimatedProperty, number>>;
            easing: Easing;
            color?: string;
        }
    > = {
        fade: {
            name: actionName('Fade', phase),
            durationMs: 800,
            delta: { opacity: -1 },
            easing: 'ease-out',
        },
        slide: {
            name: actionName('Slide', phase),
            durationMs: 900,
            delta: { y: 80, opacity: -1 },
            easing: 'ease-out',
        },
        move: {
            name: actionName('Move', phase),
            durationMs: 700,
            delta: { x: 80 },
            easing: 'ease-out',
        },
        scale: {
            name: actionName('Scale', phase),
            durationMs: 700,
            delta: { scale: phase === 'custom' ? 0.2 : -0.2, opacity: -1 },
            easing: 'ease-out',
        },
        rotate: {
            name: actionName('Rotate', phase),
            durationMs: 700,
            delta: { rotation: 45 },
            easing: 'ease-out',
        },
        opacity: {
            name: actionName('Opacity', phase),
            durationMs: 650,
            delta: { opacity: -0.65 },
            easing: 'ease-out',
        },
        color: {
            name: actionName('Color', phase),
            durationMs: 800,
            delta: {},
            color: '#2563eb',
            easing: 'ease-in-out',
        },
        blur: {
            name: actionName('Blur', phase),
            durationMs: 800,
            delta: { blur: 14, opacity: phase === 'custom' ? 0 : -0.2 },
            easing: 'ease-out',
        },
        resize: {
            name: actionName('Resize', phase),
            durationMs: 800,
            delta: { width: 120, height: 80 },
            easing: 'ease-out',
        },
        pop: {
            name: 'Pop',
            durationMs: 650,
            delta: { scale: phase === 'out' ? -0.35 : -0.18, opacity: -1 },
            easing: 'ease-out',
        },
        spin: {
            name: 'Spin',
            durationMs: 900,
            delta: { rotation: phase === 'out' ? 180 : -180, opacity: -1 },
            easing: 'ease-out',
        },
        float: {
            name: 'Float In',
            durationMs: 1000,
            delta: { y: 36, opacity: -1 },
            easing: 'ease-out',
        },
        pulse: {
            name: 'Pulse',
            durationMs: 550,
            delta: { scale: 0.08 },
            easing: 'ease-in-out',
        },
        shake: {
            name: 'Shake',
            durationMs: 420,
            delta: { x: 24 },
            easing: 'ease-in-out',
        },
        jiggle: {
            name: 'Jiggle',
            durationMs: 520,
            delta: { rotation: 8 },
            easing: 'ease-in-out',
        },
        blink: {
            name: 'Blink',
            durationMs: 500,
            delta: { opacity: -0.8 },
            easing: 'linear',
        },
        bounce: {
            name: 'Bounce',
            durationMs: 650,
            delta: { y: -48 },
            easing: 'ease-out',
        },
        click: {
            name: 'Click',
            durationMs: 180,
            delta: { scale: -0.08 },
            easing: 'ease-out',
        },
    };
    const preset = presets[kind];

    return {
        id: `${makeId('action')}-${kind}`,
        layerId,
        kind,
        phase,
        name: preset.name,
        startMs: phase === 'out' ? 3200 : 0,
        durationMs: preset.durationMs,
        easing: preset.easing,
        delta: preset.delta,
        color: preset.color,
        scope: 'layer',
        order: 'forward',
        staggerMs: 0,
        smoothing: 'ease-out',
    };
}

function makeId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`;
}

function actionProgress(
    action: AnimationAction,
    timeMs: number,
): number | null {
    if (timeMs < action.startMs) {
        return action.phase === 'in' ? 0 : null;
    }

    if (timeMs > action.startMs + action.durationMs) {
        if (
            action.phase === 'out' ||
            (action.phase === 'custom' &&
                customActionHoldsAfterEnd(action.kind))
        ) {
            return 1;
        }

        return null;
    }

    return (timeMs - action.startMs) / action.durationMs;
}

function actionMultiplier(
    action: AnimationAction,
    progress: number,
    eased: number,
): number {
    if (action.phase === 'in') {
        return 1 - eased;
    }

    if (action.phase === 'out' || customActionHoldsAfterEnd(action.kind)) {
        return eased;
    }

    if (action.kind === 'blink') {
        return Math.sin(progress * Math.PI * 8) > 0 ? 1 : 0;
    }

    if (['shake', 'jiggle'].includes(action.kind)) {
        return Math.sin(progress * Math.PI * 8) * (1 - progress);
    }

    return Math.sin(progress * Math.PI);
}

function colorProgress(
    action: AnimationAction,
    progress: number,
    eased: number,
    multiplier: number,
): number {
    if (action.phase === 'in') {
        return eased;
    }

    if (action.phase === 'custom' && !customActionHoldsAfterEnd(action.kind)) {
        return Math.max(0, Math.min(1, multiplier));
    }

    return progress >= 1 ? 1 : eased;
}

function customActionHoldsAfterEnd(kind: AnimationActionKind): boolean {
    return [
        'move',
        'scale',
        'rotate',
        'opacity',
        'color',
        'blur',
        'resize',
    ].includes(kind);
}

function actionName(name: string, phase: AnimationActionPhase): string {
    if (phase === 'custom') {
        return name;
    }

    return `${name} ${phase === 'out' ? 'Out' : 'In'}`;
}

function colorAtProgress(
    baseColor: string,
    actionColor: string,
    progress: number,
    phase: AnimationActionPhase,
): string {
    const base = parseHexColor(baseColor);
    const target = parseHexColor(actionColor);

    if (!base || !target) {
        return phase === 'in' && progress < 1 ? actionColor : baseColor;
    }

    if (phase === 'in') {
        return mixHexColor(target, base, progress);
    }

    return mixHexColor(base, target, progress);
}

function parseHexColor(value: string): [number, number, number] | null {
    if (!/^#[0-9a-f]{6}$/i.test(value)) {
        return null;
    }

    return [
        Number.parseInt(value.slice(1, 3), 16),
        Number.parseInt(value.slice(3, 5), 16),
        Number.parseInt(value.slice(5, 7), 16),
    ];
}

function mixHexColor(
    from: [number, number, number],
    to: [number, number, number],
    progress: number,
): string {
    return `#${from
        .map((channel, index) =>
            Math.round(channel + (to[index] - channel) * progress)
                .toString(16)
                .padStart(2, '0'),
        )
        .join('')}`;
}

function ease(progress: number, easing: Easing): number {
    if (easing === 'ease-in') {
        return progress * progress;
    }

    if (easing === 'ease-out') {
        return 1 - (1 - progress) * (1 - progress);
    }

    if (easing === 'ease-in-out') {
        return progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    }

    return progress;
}
