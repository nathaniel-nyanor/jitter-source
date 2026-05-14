import type { FormDataConvertible } from '@inertiajs/core';
import { Head, Link, router } from '@inertiajs/react';
import {
    ArrowLeft,
    Circle,
    Component,
    Copy,
    Download,
    FileJson,
    Eye,
    EyeOff,
    Image,
    Layers3,
    Lock,
    Pause,
    Play,
    Redo2,
    Save,
    Square,
    SquareDashed,
    Trash2,
    Type,
    Undo2,
    Unlock,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
    PointerEvent as ReactPointerEvent,
    ReactNode,
    WheelEvent as ReactWheelEvent,
} from 'react';
import {
    download,
    update,
    uploadImage,
} from '@/actions/App/Http/Controllers/ProjectController';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    createAction,
    createLayer,
    deleteLayer,
    deleteAction,
    duplicateLayer,
    groupLayer,
    layerWithActionsAtTime,
    moveLayer,
    updateAction,
    updateLayer,
} from '@/lib/composition';
import {
    clearEditorLogs,
    installEditorErrorLogging,
    logEditorEvent,
    readEditorLogs,
} from '@/lib/editor-logger';
import { index as projectsIndex } from '@/routes/projects';
import type {
    AnimatedProperty,
    AnimationAction,
    AnimationActionKind,
    AnimationActionPhase,
    Composition,
    EditorProject,
    Easing,
    Layer,
    LayerType,
    Transform,
} from '@/types';

const defaultCanvasScale = 0.48;
const historyLimit = 50;
const minCanvasScale = 0.12;
const maxCanvasScale = 3;
const minSceneDurationMs = 100;
const maxSceneDurationMs = 120000;
const actionDeltaProperties: AnimatedProperty[] = [
    'x',
    'y',
    'width',
    'height',
    'scale',
    'rotation',
    'opacity',
    'blur',
];
const easingOptions: Easing[] = [
    'linear',
    'ease-in',
    'ease-out',
    'ease-in-out',
];

type LegacyComposition = Omit<Composition, 'actions'> & {
    actions?: AnimationAction[];
    tracks?: unknown[];
};

function normalizeComposition(composition: LegacyComposition): Composition {
    const durationMs = clampNumber(composition.durationMs, {
        min: minSceneDurationMs,
        max: maxSceneDurationMs,
    });

    return {
        ...composition,
        durationMs,
        layers: composition.layers.map((layer) => ({
            ...layer,
            transform: {
                ...layer.transform,
                blur: layer.transform.blur ?? 0,
            },
        })),
        actions: (composition.actions ?? []).map((action) =>
            clampActionToDuration(
                {
                    ...action,
                    scope: action.scope ?? 'layer',
                    order: action.order ?? 'forward',
                    staggerMs: action.staggerMs ?? 0,
                    smoothing: action.smoothing ?? action.easing,
                },
                durationMs,
            ),
        ),
    };
}

export default function ProjectEditor({ project }: { project: EditorProject }) {
    const initialComposition = normalizeComposition(project.composition);
    const [composition, setComposition] =
        useState<Composition>(initialComposition);
    const [selectedLayerId, setSelectedLayerId] = useState(
        initialComposition.layers[0]?.id ?? '',
    );
    const [selectedActionId, setSelectedActionId] = useState(
        initialComposition.actions[0]?.id ?? '',
    );
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [canvasScale, setCanvasScale] = useState(defaultCanvasScale);
    const [copiedActions, setCopiedActions] = useState<AnimationAction[]>([]);
    const [imageUploadError, setImageUploadError] = useState<string | null>(
        null,
    );
    const [past, setPast] = useState<Composition[]>([]);
    const [future, setFuture] = useState<Composition[]>([]);
    const currentTimeRef = useRef(0);
    const durationRef = useRef(initialComposition.durationMs);
    const playStartedAt = useRef(0);
    const playStartTime = useRef(0);
    const interactionStartComposition = useRef<Composition | null>(null);
    const compositionRef = useRef(composition);

    const selectedLayer = composition.layers.find(
        (layer) => layer.id === selectedLayerId,
    );

    const previewLayers = useMemo(() => {
        return composition.layers.map((layer) =>
            layerWithActionsAtTime(layer, composition.actions, currentTime),
        );
    }, [composition.actions, composition.layers, currentTime]);

    useEffect(() => {
        compositionRef.current = composition;
    }, [composition]);

    useEffect(() => {
        window.__JITTER_LOGS__ = readEditorLogs;

        logEditorEvent('editor.mounted', {
            projectId: project.id,
            layerCount: composition.layers.length,
            actionCount: composition.actions.length,
        });

        const uninstallErrorLogging = installEditorErrorLogging();

        return () => {
            logEditorEvent('editor.unmounted', { projectId: project.id });
            uninstallErrorLogging();
            delete window.__JITTER_LOGS__;
        };
        // Mount and unmount logging should only run for this editor instance.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [project.id]);

    useEffect(() => {
        durationRef.current = composition.durationMs;

        if (currentTimeRef.current <= composition.durationMs) {
            return;
        }

        currentTimeRef.current = composition.durationMs;
        setCurrentTime(composition.durationMs);
    }, [composition.durationMs]);

    useEffect(() => {
        if (!isPlaying) {
            return;
        }

        playStartedAt.current = performance.now();
        playStartTime.current = currentTimeRef.current;
        let animationFrame = 0;

        const tick = (now: number) => {
            const duration = Math.max(durationRef.current, 1);
            const elapsed = now - playStartedAt.current;
            const nextTime = (playStartTime.current + elapsed) % duration;

            currentTimeRef.current = nextTime;
            setCurrentTime(nextTime);
            animationFrame = requestAnimationFrame(tick);
        };

        logEditorEvent('playback.loop.started', {
            projectId: project.id,
            startTimeMs: currentTimeRef.current,
            durationMs: durationRef.current,
        });

        animationFrame = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(animationFrame);
            logEditorEvent('playback.loop.stopped', {
                projectId: project.id,
                currentTimeMs: currentTimeRef.current,
            });
        };
    }, [isPlaying, project.id]);

    function commitComposition(
        updater: (current: Composition) => Composition,
        nextSelectedLayerId?: string,
    ) {
        setComposition((current) => {
            const next = updater(current);

            if (next === current) {
                return current;
            }

            setPast((history) => [
                ...history.slice(-historyLimit + 1),
                current,
            ]);
            setFuture([]);

            return next;
        });

        if (nextSelectedLayerId !== undefined) {
            setSelectedLayerId(nextSelectedLayerId);
        }
    }

    function updateCompositionDuringInteraction(
        updater: (current: Composition) => Composition,
    ) {
        setComposition((current) => updater(current));
    }

    function beginInteraction() {
        interactionStartComposition.current ??= composition;
    }

    function endInteraction() {
        const startedFrom = interactionStartComposition.current;

        if (!startedFrom) {
            return;
        }

        interactionStartComposition.current = null;

        if (
            JSON.stringify(startedFrom) ===
            JSON.stringify(compositionRef.current)
        ) {
            return;
        }

        setPast((history) => [
            ...history.slice(-historyLimit + 1),
            startedFrom,
        ]);
        setFuture([]);
    }

    function undo() {
        setPast((history) => {
            const previous = history.at(-1);

            if (!previous) {
                return history;
            }

            setFuture((items) =>
                [composition, ...items].slice(0, historyLimit),
            );
            setComposition(previous);
            setSelectedLayerId(previous.layers[0]?.id ?? '');

            return history.slice(0, -1);
        });
    }

    function redo() {
        setFuture((items) => {
            const next = items[0];

            if (!next) {
                return items;
            }

            setPast((history) => [
                ...history.slice(-historyLimit + 1),
                composition,
            ]);
            setComposition(next);
            setSelectedLayerId(next.layers[0]?.id ?? '');

            return items.slice(1);
        });
    }

    function addLayer(type: LayerType) {
        const layer = createLayer(type, composition.layers.length + 1);

        logEditorEvent('layer.add.requested', {
            type,
            layerId: layer.id,
            selectedLayerId,
        });

        commitComposition((current) => {
            const selectedIndex = current.layers.findIndex(
                (item) => item.id === selectedLayerId,
            );

            if (selectedIndex < 0) {
                return {
                    ...current,
                    layers: [...current.layers, layer],
                };
            }

            const layers = [...current.layers];
            layers.splice(selectedIndex, 0, layer);

            return {
                ...current,
                layers,
            };
        }, layer.id);
    }

    function groupSelectedLayer() {
        logEditorEvent('layer.group.requested', { selectedLayerId });

        if (!selectedLayerId) {
            addLayer('group');

            return;
        }

        const result = groupLayer(composition, selectedLayerId);

        commitComposition(() => result.composition, result.layerId);
    }

    function patchSelected(updater: (layer: Layer) => Layer) {
        if (!selectedLayerId) {
            return;
        }

        commitComposition((current) =>
            updateLayer(current, selectedLayerId, updater),
        );
    }

    function saveProject() {
        logEditorEvent('project.save.requested', {
            projectId: project.id,
            layerCount: composition.layers.length,
            actionCount: composition.actions.length,
        });

        setIsSaving(true);
        router.patch(
            update(project.id).url,
            {
                composition: composition as unknown as FormDataConvertible,
            },
            {
                preserveScroll: true,
                onError: (errors) =>
                    logEditorEvent('project.save.failed', { errors }),
                onSuccess: () =>
                    logEditorEvent('project.save.succeeded', {
                        projectId: project.id,
                    }),
                onFinish: () => setIsSaving(false),
            },
        );
    }

    async function uploadImageForSelectedLayer(file: File) {
        if (!selectedLayerId) {
            return;
        }

        logEditorEvent('image.upload.requested', {
            projectId: project.id,
            layerId: selectedLayerId,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
        });

        setIsUploadingImage(true);
        setImageUploadError(null);

        const body = new FormData();
        body.append('image', file);

        try {
            const response = await fetch(uploadImage(project.id).url, {
                method: 'POST',
                body,
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json',
                    'X-XSRF-TOKEN': csrfToken(),
                },
            });

            const payload = (await response.json()) as {
                url?: string;
                message?: string;
                errors?: { image?: string[] };
            };

            if (!response.ok || !payload.url) {
                logEditorEvent('image.upload.failed', {
                    projectId: project.id,
                    layerId: selectedLayerId,
                    status: response.status,
                    payload,
                });
                setImageUploadError(
                    payload.errors?.image?.[0] ??
                        payload.message ??
                        'Image upload failed.',
                );

                return;
            }

            commitComposition((current) =>
                updateLayer(current, selectedLayerId, (layer) => ({
                    ...layer,
                    content: payload.url,
                })),
            );
            logEditorEvent('image.upload.succeeded', {
                projectId: project.id,
                layerId: selectedLayerId,
                url: payload.url,
            });
        } catch {
            logEditorEvent('image.upload.crashed', {
                projectId: project.id,
                layerId: selectedLayerId,
            });
            setImageUploadError('Image upload failed.');
        } finally {
            setIsUploadingImage(false);
        }
    }

    function toggleLayerHidden(layerId: string) {
        const layer = composition.layers.find((item) => item.id === layerId);

        logEditorEvent('layer.visibility.toggle', {
            layerId,
            previousHidden: layer?.hidden,
            nextHidden: layer ? !layer.hidden : null,
        });

        commitComposition((current) =>
            updateLayer(current, layerId, (layer) => ({
                ...layer,
                hidden: !layer.hidden,
            })),
        );
    }

    function toggleLayerLocked(layerId: string) {
        const layer = composition.layers.find((item) => item.id === layerId);

        logEditorEvent('layer.lock.toggle', {
            layerId,
            previousLocked: layer?.locked,
            nextLocked: layer ? !layer.locked : null,
        });

        commitComposition((current) =>
            updateLayer(current, layerId, (layer) => ({
                ...layer,
                locked: !layer.locked,
            })),
        );
    }

    function moveCanvasLayer(
        current: Composition,
        layerId: string,
        x: number,
        y: number,
    ): Composition {
        const source = current.layers.find((layer) => layer.id === layerId);

        if (!source) {
            return current;
        }

        const deltaX = x - source.transform.x;
        const deltaY = y - source.transform.y;

        return {
            ...current,
            layers: current.layers.map((layer) => {
                if (layer.id === layerId) {
                    return {
                        ...layer,
                        transform: {
                            ...layer.transform,
                            x,
                            y,
                        },
                    };
                }

                if (source.type === 'group' && layer.parentId === layerId) {
                    return {
                        ...layer,
                        transform: {
                            ...layer.transform,
                            x: layer.transform.x + deltaX,
                            y: layer.transform.y + deltaY,
                        },
                    };
                }

                return layer;
            }),
        };
    }

    function applyPreset(
        preset: AnimationActionKind,
        phase: AnimationActionPhase = 'in',
    ) {
        if (!selectedLayerId) {
            return;
        }

        const action = clampActionToDuration(
            createAction(selectedLayerId, preset, phase),
            composition.durationMs,
        );

        logEditorEvent('animation.action.added', {
            layerId: selectedLayerId,
            actionId: action.id,
            preset,
            phase,
        });

        commitComposition((current) => ({
            ...current,
            actions: [...current.actions, action],
        }));
        setSelectedActionId(action.id);
    }

    function patchAction(
        actionId: string,
        updater: (action: AnimationAction) => AnimationAction,
    ) {
        logEditorEvent('animation.action.updated', { actionId });
        commitComposition((current) =>
            updateAction(current, actionId, updater),
        );
    }

    function removeAction(actionId: string) {
        logEditorEvent('animation.action.deleted', { actionId });
        commitComposition((current) => deleteAction(current, actionId));

        if (selectedActionId === actionId) {
            setSelectedActionId('');
        }
    }

    function copySelectedAction() {
        const action = composition.actions.find(
            (item) => item.id === selectedActionId,
        );

        if (!action) {
            return;
        }

        setCopiedActions([structuredClone(action)]);
        logEditorEvent('animation.action.copied', {
            actionId: action.id,
            layerId: action.layerId,
        });
    }

    function pasteCopiedActions() {
        if (!selectedLayerId || copiedActions.length === 0) {
            return;
        }

        const earliestStart = Math.min(
            ...copiedActions.map((action) => action.startMs),
        );
        const pastedActions = copiedActions.map((action, index) => {
            const durationMs = Math.min(
                action.durationMs,
                Math.max(50, composition.durationMs - currentTimeRef.current),
            );

            return {
                ...structuredClone(action),
                id: `action-${crypto.randomUUID()}-${action.kind}-${index}`,
                layerId: selectedLayerId,
                startMs: clampNumber(
                    currentTimeRef.current + action.startMs - earliestStart,
                    {
                        min: 0,
                        max: Math.max(0, composition.durationMs - durationMs),
                    },
                ),
                durationMs,
            };
        });

        commitComposition((current) => ({
            ...current,
            actions: [...current.actions, ...pastedActions],
        }));
        setSelectedActionId(pastedActions[0]?.id ?? '');
        logEditorEvent('animation.action.pasted', {
            layerId: selectedLayerId,
            actionCount: pastedActions.length,
            timeMs: currentTimeRef.current,
        });
    }

    function duplicateSelectedAction() {
        const action = composition.actions.find(
            (item) => item.id === selectedActionId,
        );

        if (!action) {
            duplicateSelectedLayer();

            return;
        }

        const duplicate = {
            ...structuredClone(action),
            id: `action-${crypto.randomUUID()}-${action.kind}`,
            startMs: clampNumber(action.startMs + 160, {
                min: 0,
                max: Math.max(0, composition.durationMs - action.durationMs),
            }),
        };

        commitComposition((current) => ({
            ...current,
            actions: [...current.actions, duplicate],
        }));
        setSelectedActionId(duplicate.id);
        logEditorEvent('animation.action.duplicated', {
            sourceActionId: action.id,
            nextActionId: duplicate.id,
        });
    }

    function updateSceneDuration(durationMs: number) {
        const nextDuration = clampNumber(durationMs, {
            min: minSceneDurationMs,
            max: maxSceneDurationMs,
        });
        const updater = (current: Composition): Composition => ({
            ...current,
            durationMs: nextDuration,
            actions: current.actions.map((action) =>
                clampActionToDuration(action, nextDuration),
            ),
        });

        if (interactionStartComposition.current) {
            updateCompositionDuringInteraction(updater);
        } else {
            commitComposition(updater);
        }

        durationRef.current = nextDuration;
        seekPlayhead(currentTimeRef.current, 'duration_change');
        logEditorEvent('timeline.duration.changed', {
            projectId: project.id,
            durationMs: nextDuration,
        });
    }

    function duplicateSelectedLayer() {
        if (!selectedLayerId || isPlaying) {
            return;
        }

        logEditorEvent('layer.duplicate.requested', { selectedLayerId });

        const result = duplicateLayer(composition, selectedLayerId);

        commitComposition(() => result.composition, result.layerId);
    }

    function deleteSelectedLayer() {
        if (!selectedLayerId || isPlaying) {
            return;
        }

        logEditorEvent('layer.delete.requested', { selectedLayerId });

        const selectedIndex = composition.layers.findIndex(
            (layer) => layer.id === selectedLayerId,
        );
        const nextLayerId =
            composition.layers[selectedIndex - 1]?.id ??
            composition.layers[selectedIndex + 1]?.id ??
            '';

        commitComposition(
            (current) => deleteLayer(current, selectedLayerId),
            nextLayerId,
        );
    }

    function exportEditorLogs() {
        const blob = new Blob([JSON.stringify(readEditorLogs(), null, 2)], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${composition.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'motion'}-debug-logs.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        logEditorEvent('logs.exported', { projectId: project.id });
    }

    function seekPlayhead(timeMs: number, source: string) {
        const nextTime = clampNumber(timeMs, {
            min: 0,
            max: durationRef.current,
        });

        currentTimeRef.current = nextTime;
        setCurrentTime(nextTime);

        if (isPlaying) {
            playStartedAt.current = performance.now();
            playStartTime.current = nextTime;
        }

        logEditorEvent('playback.seek', {
            source,
            projectId: project.id,
            nextTimeMs: nextTime,
            isPlaying,
        });
    }

    function togglePlayback() {
        if (!isPlaying) {
            const currentPlayhead = currentTimeRef.current;
            const duration = durationRef.current;
            const hasActiveOrUpcomingAction = composition.actions.some(
                (action) =>
                    currentPlayhead <= action.startMs + action.durationMs,
            );
            const startTime =
                !hasActiveOrUpcomingAction || currentPlayhead >= duration - 16
                    ? 0
                    : currentPlayhead;

            currentTimeRef.current = startTime;
            setCurrentTime(startTime);

            logEditorEvent('playback.started', {
                projectId: project.id,
                startTimeMs: startTime,
                restartedFromBeginning: startTime === 0 && currentPlayhead > 0,
            });
        } else {
            logEditorEvent('playback.paused', {
                projectId: project.id,
                currentTimeMs: currentTimeRef.current,
            });
        }

        setIsPlaying((value) => !value);
    }

    function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            const nextScale = clampNumber(
                canvasScale * (event.deltaY > 0 ? 0.9 : 1.1),
                { min: minCanvasScale, max: maxCanvasScale },
            );

            setCanvasScale(nextScale);
            logEditorEvent('viewport.zoom.wheel', {
                previousScale: canvasScale,
                nextScale,
                deltaY: event.deltaY,
                modifier: event.metaKey ? 'meta' : 'ctrl',
            });

            return;
        }

        if (event.altKey || event.shiftKey) {
            event.preventDefault();
            event.currentTarget.scrollLeft += event.deltaY + event.deltaX;
            logEditorEvent('viewport.pan.horizontal_wheel', {
                deltaX: event.deltaX,
                deltaY: event.deltaY,
                altKey: event.altKey,
                shiftKey: event.shiftKey,
                scrollLeft: event.currentTarget.scrollLeft,
            });
        }
    }

    function resetCanvasZoom() {
        setCanvasScale(defaultCanvasScale);
        logEditorEvent('viewport.zoom.reset', {
            nextScale: defaultCanvasScale,
        });
    }

    function selectLayer(layerId: string, source: string) {
        setSelectedLayerId(layerId);
        setSelectedActionId('');
        logEditorEvent('selection.changed', {
            source,
            previousLayerId: selectedLayerId,
            nextLayerId: layerId,
        });
    }

    function clearSelection(source: string) {
        if (!selectedLayerId) {
            return;
        }

        setSelectedLayerId('');
        setSelectedActionId('');
        logEditorEvent('selection.cleared', {
            source,
            previousLayerId: selectedLayerId,
        });
    }

    function selectAction(actionId: string, layerId: string, source: string) {
        setSelectedLayerId(layerId);
        setSelectedActionId(actionId);
        logEditorEvent('animation.action.selected', {
            source,
            layerId,
            actionId,
        });
    }

    useEffect(() => {
        function handleKeyboard(event: KeyboardEvent) {
            const target = event.target as HTMLElement | null;
            const isTyping =
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target instanceof HTMLSelectElement ||
                target?.isContentEditable;

            if (isTyping) {
                return;
            }

            const modifier = event.metaKey || event.ctrlKey;

            if (modifier && event.key.toLowerCase() === 'z' && event.shiftKey) {
                event.preventDefault();
                redo();

                return;
            }

            if (modifier && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                undo();

                return;
            }

            if (modifier && event.key.toLowerCase() === 'd') {
                event.preventDefault();
                duplicateSelectedAction();

                return;
            }

            if (modifier && event.key.toLowerCase() === 'c') {
                event.preventDefault();
                copySelectedAction();

                return;
            }

            if (modifier && event.key.toLowerCase() === 'v') {
                event.preventDefault();
                pasteCopiedActions();

                return;
            }

            if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();

                if (selectedActionId) {
                    removeAction(selectedActionId);

                    return;
                }

                deleteSelectedLayer();
            }
        }

        window.addEventListener('keydown', handleKeyboard);

        return () => window.removeEventListener('keydown', handleKeyboard);
    });

    return (
        <>
            <Head title={`${composition.name} Editor`} />
            <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
                <header className="flex h-14 shrink-0 items-center justify-between border-b px-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <Button variant="ghost" size="icon" asChild>
                            <Link href={projectsIndex()}>
                                <ArrowLeft />
                            </Link>
                        </Button>
                        <Input
                            value={composition.name}
                            onChange={(event) =>
                                setComposition((current) => ({
                                    ...current,
                                    name: event.target.value,
                                }))
                            }
                            className="h-9 max-w-72 border-transparent px-2 text-base font-medium shadow-none"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={undo}
                            disabled={past.length === 0}
                            title="Undo"
                        >
                            <Undo2 />
                            Undo
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={redo}
                            disabled={future.length === 0}
                            title="Redo"
                        >
                            <Redo2 />
                            Redo
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={duplicateSelectedLayer}
                            disabled={!selectedLayer}
                            title="Duplicate selected layer"
                        >
                            <Copy />
                            Duplicate
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={deleteSelectedLayer}
                            disabled={!selectedLayer}
                            title="Delete selected layer"
                            className="text-destructive hover:text-destructive"
                        >
                            <Trash2 />
                            Delete
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                            <a href={download(project.id).url}>
                                <Download />
                                JSON
                            </a>
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={saveProject}
                            disabled={isSaving}
                        >
                            <Save />
                            {isSaving ? 'Saving' : 'Save'}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={exportEditorLogs}
                            title="Export debug logs"
                        >
                            <FileJson />
                            Logs
                        </Button>
                    </div>
                </header>

                <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_300px]">
                    <aside className="flex min-h-0 flex-col border-r">
                        <div className="border-b p-3">
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => addLayer('text')}
                                >
                                    <Type />
                                    Text
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => addLayer('rectangle')}
                                >
                                    <Square />
                                    Box
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => addLayer('ellipse')}
                                >
                                    <Circle />
                                    Oval
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => addLayer('image')}
                                >
                                    <Image />
                                    Image
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => addLayer('frame')}
                                >
                                    <SquareDashed />
                                    Frame
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={groupSelectedLayer}
                                >
                                    <Component />
                                    Group
                                </Button>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
                            <Layers3 className="size-4" />
                            Layers
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-2">
                            {[...composition.layers].reverse().map((layer) => (
                                <div
                                    key={layer.id}
                                    className={`flex items-center gap-2 rounded-md text-sm transition ${
                                        layer.id === selectedLayerId
                                            ? 'bg-primary text-primary-foreground'
                                            : 'hover:bg-accent'
                                    }`}
                                >
                                    <button
                                        type="button"
                                        onClick={() =>
                                            selectLayer(
                                                layer.id,
                                                'layers_panel',
                                            )
                                        }
                                        className="min-w-0 flex-1 px-3 py-2 text-left"
                                        style={{
                                            paddingLeft: layer.parentId
                                                ? 24
                                                : 12,
                                        }}
                                    >
                                        <span className="truncate">
                                            {layer.parentId ? '- ' : ''}
                                            {layer.name}
                                        </span>
                                    </button>
                                    <div className="flex shrink-0 items-center gap-1 pr-2">
                                        <button
                                            type="button"
                                            aria-label={
                                                layer.hidden
                                                    ? `Show ${layer.name}`
                                                    : `Hide ${layer.name}`
                                            }
                                            title={
                                                layer.hidden
                                                    ? `Show ${layer.name}`
                                                    : `Hide ${layer.name}`
                                            }
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                toggleLayerHidden(layer.id);
                                            }}
                                            className="rounded p-1 opacity-75 transition hover:bg-background/60 hover:opacity-100 [&_svg]:pointer-events-none"
                                        >
                                            {layer.hidden ? (
                                                <EyeOff className="size-3.5" />
                                            ) : (
                                                <Eye className="size-3.5" />
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={
                                                layer.locked
                                                    ? `Unlock ${layer.name}`
                                                    : `Lock ${layer.name}`
                                            }
                                            title={
                                                layer.locked
                                                    ? `Unlock ${layer.name}`
                                                    : `Lock ${layer.name}`
                                            }
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                toggleLayerLocked(layer.id);
                                            }}
                                            className="rounded p-1 opacity-75 transition hover:bg-background/60 hover:opacity-100 [&_svg]:pointer-events-none"
                                        >
                                            {layer.locked ? (
                                                <Lock className="size-3.5" />
                                            ) : (
                                                <Unlock className="size-3.5" />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </aside>

                    <main className="flex min-h-0 flex-col bg-muted/40">
                        <div className="flex h-10 shrink-0 items-center justify-end gap-2 border-b bg-background px-4">
                            <span className="text-xs text-muted-foreground tabular-nums">
                                {Math.round(canvasScale * 100)}%
                            </span>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={resetCanvasZoom}
                            >
                                Reset zoom
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    clearEditorLogs();
                                    logEditorEvent('logs.clear.requested', {
                                        projectId: project.id,
                                    });
                                }}
                            >
                                Clear logs
                            </Button>
                        </div>
                        <div
                            className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-8"
                            onPointerDown={() => clearSelection('viewport')}
                            onWheel={handleCanvasWheel}
                        >
                            <div
                                className="relative shrink-0 overflow-visible rounded-lg bg-white shadow-2xl ring-1 ring-black/10"
                                data-editor-artboard
                                style={{
                                    width: composition.width,
                                    height: composition.height,
                                    transform: `scale(${canvasScale})`,
                                }}
                            >
                                <div
                                    className="absolute inset-0"
                                    style={{
                                        background: composition.background,
                                    }}
                                    onPointerDown={() =>
                                        clearSelection('artboard_background')
                                    }
                                />
                                {previewLayers.map((layer) => (
                                    <CanvasLayer
                                        key={layer.id}
                                        layer={layer}
                                        canvasScale={canvasScale}
                                        selected={layer.id === selectedLayerId}
                                        onSelect={() =>
                                            selectLayer(layer.id, 'canvas')
                                        }
                                        onMove={(x, y) =>
                                            updateCompositionDuringInteraction(
                                                (current) =>
                                                    moveCanvasLayer(
                                                        current,
                                                        layer.id,
                                                        x,
                                                        y,
                                                    ),
                                            )
                                        }
                                        onResize={(transform) =>
                                            updateCompositionDuringInteraction(
                                                (current) =>
                                                    updateLayer(
                                                        current,
                                                        layer.id,
                                                        (item) => ({
                                                            ...item,
                                                            transform,
                                                        }),
                                                    ),
                                            )
                                        }
                                        onInteractionStart={beginInteraction}
                                        onInteractionEnd={endInteraction}
                                    />
                                ))}
                            </div>
                        </div>

                        <Timeline
                            composition={composition}
                            currentTime={currentTime}
                            selectedActionId={selectedActionId}
                            selectedLayerId={selectedLayerId}
                            isPlaying={isPlaying}
                            onPlayToggle={togglePlayback}
                            onTimeChange={(timeMs) =>
                                seekPlayhead(timeMs, 'timeline')
                            }
                            onActionSelect={selectAction}
                            onActionChangeDuringInteraction={(
                                actionId,
                                updater,
                            ) =>
                                updateCompositionDuringInteraction((current) =>
                                    updateAction(current, actionId, updater),
                                )
                            }
                            onInteractionStart={beginInteraction}
                            onInteractionEnd={endInteraction}
                            onDurationChange={updateSceneDuration}
                        />
                    </main>

                    <aside className="min-h-0 overflow-y-auto border-l p-4">
                        <Inspector
                            layer={selectedLayer}
                            composition={composition}
                            onCompositionChange={(nextComposition) =>
                                commitComposition(() =>
                                    clampCompositionToDuration(
                                        nextComposition,
                                        nextComposition.durationMs,
                                    ),
                                )
                            }
                            onLayerChange={patchSelected}
                            onPreset={applyPreset}
                            onImageUpload={uploadImageForSelectedLayer}
                            imageUploadError={imageUploadError}
                            isImageUploading={isUploadingImage}
                            onMoveLayer={(direction) =>
                                selectedLayerId &&
                                commitComposition((current) =>
                                    moveLayer(
                                        current,
                                        selectedLayerId,
                                        direction,
                                    ),
                                )
                            }
                            currentTime={currentTime}
                            selectedActionId={selectedActionId}
                            onActionSelect={selectAction}
                            onActionChange={patchAction}
                            onActionDelete={removeAction}
                        />
                    </aside>
                </div>
            </div>
        </>
    );
}

function CanvasLayer({
    layer,
    canvasScale,
    selected,
    onSelect,
    onMove,
    onResize,
    onInteractionStart,
    onInteractionEnd,
}: {
    layer: Layer;
    canvasScale: number;
    selected: boolean;
    onSelect: () => void;
    onMove: (x: number, y: number) => void;
    onResize: (transform: Transform) => void;
    onInteractionStart: () => void;
    onInteractionEnd: () => void;
}) {
    const dragStart = useRef({ pointerX: 0, pointerY: 0, x: 0, y: 0 });

    if (layer.hidden) {
        return null;
    }

    function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
        event.stopPropagation();
        onSelect();
        logEditorEvent('canvas.layer.pointer_down', {
            layerId: layer.id,
            locked: layer.locked,
            pointerX: event.clientX,
            pointerY: event.clientY,
        });

        if (layer.locked) {
            return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        onInteractionStart();
        dragStart.current = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            x: layer.transform.x,
            y: layer.transform.y,
        };
    }

    function drag(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.buttons !== 1 || layer.locked) {
            return;
        }

        const deltaX =
            (event.clientX - dragStart.current.pointerX) / canvasScale;
        const deltaY =
            (event.clientY - dragStart.current.pointerY) / canvasScale;

        onMove(dragStart.current.x + deltaX, dragStart.current.y + deltaY);
    }

    function stopInteraction(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        logEditorEvent('canvas.layer.interaction_end', {
            layerId: layer.id,
            transform: layer.transform,
        });
        onInteractionEnd();
    }

    function startResize(
        event: ReactPointerEvent<HTMLButtonElement>,
        handle: ResizeHandle,
    ) {
        if (layer.locked) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        onSelect();
        onInteractionStart();
        logEditorEvent('canvas.layer.resize_start', {
            layerId: layer.id,
            handle,
            transform: layer.transform,
        });

        const startPointerX = event.clientX;
        const startPointerY = event.clientY;
        const startTransform = layer.transform;

        function resize(pointerEvent: PointerEvent) {
            pointerEvent.preventDefault();

            const deltaX = (pointerEvent.clientX - startPointerX) / canvasScale;
            const deltaY = (pointerEvent.clientY - startPointerY) / canvasScale;
            const nextTransform = resizeTransform(
                startTransform,
                handle,
                deltaX,
                deltaY,
            );

            onResize(nextTransform);
        }

        function stopResize() {
            window.removeEventListener('pointermove', resize);
            window.removeEventListener('pointerup', stopResize);
            window.removeEventListener('pointercancel', stopResize);
            logEditorEvent('canvas.layer.resize_end', {
                layerId: layer.id,
                handle,
            });
            onInteractionEnd();
        }

        window.addEventListener('pointermove', resize);
        window.addEventListener('pointerup', stopResize, { once: true });
        window.addEventListener('pointercancel', stopResize, { once: true });
    }

    const style = {
        left: layer.transform.x,
        top: layer.transform.y,
        width: layer.transform.width,
        height: layer.transform.height,
        opacity: layer.transform.opacity,
        filter: layer.transform.blur
            ? `blur(${layer.transform.blur}px)`
            : undefined,
        transform: `rotate(${layer.transform.rotation}deg) scale(${layer.transform.scale})`,
        transformOrigin: 'top left',
    };
    const alignmentClass =
        layer.type === 'text'
            ? 'items-start justify-start'
            : 'items-center justify-center';

    return (
        <div
            className={`absolute flex select-none ${alignmentClass} ${
                layer.locked ? 'cursor-default' : 'cursor-move'
            } ${selected ? 'ring-4 ring-blue-500/70' : ''}`}
            data-editor-layer={layer.id}
            data-selected={selected ? 'true' : 'false'}
            style={style}
            onPointerDown={startDrag}
            onPointerMove={drag}
            onPointerUp={stopInteraction}
            onPointerCancel={stopInteraction}
        >
            {layer.type === 'text' && (
                <div
                    className="pointer-events-none w-full leading-none"
                    style={{
                        color: layer.fill,
                        fontSize: layer.fontSize,
                        fontWeight: layer.fontWeight,
                    }}
                >
                    {layer.content}
                </div>
            )}
            {layer.type === 'rectangle' && (
                <div
                    className="pointer-events-none size-full rounded-2xl"
                    style={{ background: layer.fill }}
                />
            )}
            {layer.type === 'ellipse' && (
                <div
                    className="pointer-events-none size-full rounded-full"
                    style={{ background: layer.fill }}
                />
            )}
            {layer.type === 'frame' && (
                <div
                    className="pointer-events-none size-full rounded-sm border-2 border-sky-500/70"
                    style={{ background: layer.fill }}
                />
            )}
            {layer.type === 'group' && (
                <div className="pointer-events-none size-full rounded-sm border-2 border-dashed border-amber-500/80 bg-amber-400/5" />
            )}
            {layer.type === 'image' && (
                <div
                    className="pointer-events-none flex size-full items-center justify-center overflow-hidden rounded-2xl border-4 border-dashed border-blue-400 bg-blue-50 text-4xl font-semibold text-blue-700"
                    style={{ background: layer.fill }}
                >
                    {layer.content ? (
                        <img
                            src={layer.content}
                            alt={layer.name}
                            className="size-full object-cover"
                        />
                    ) : (
                        'Image'
                    )}
                </div>
            )}
            {selected &&
                !layer.locked &&
                resizeHandles.map((handle) => (
                    <button
                        key={handle}
                        type="button"
                        aria-label={`Resize ${handle}`}
                        data-resize-handle={handle}
                        className={`absolute size-4 rounded-full border-2 border-white bg-blue-600 shadow ${resizeHandleClasses[handle]}`}
                        style={{
                            transform: `scale(${1 / Math.max(layer.transform.scale, 0.1)})`,
                        }}
                        onPointerDown={(event) => startResize(event, handle)}
                    />
                ))}
        </div>
    );
}

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

const resizeHandles: ResizeHandle[] = ['nw', 'ne', 'sw', 'se'];

const resizeHandleClasses: Record<ResizeHandle, string> = {
    nw: '-top-2 -left-2 cursor-nwse-resize',
    ne: '-top-2 -right-2 cursor-nesw-resize',
    sw: '-bottom-2 -left-2 cursor-nesw-resize',
    se: '-right-2 -bottom-2 cursor-nwse-resize',
};

function resizeTransform(
    transform: Transform,
    handle: ResizeHandle,
    deltaX: number,
    deltaY: number,
): Transform {
    const minSize = 24;
    let { x, y, width, height } = transform;

    if (handle.includes('e')) {
        width = Math.max(minSize, transform.width + deltaX);
    }

    if (handle.includes('s')) {
        height = Math.max(minSize, transform.height + deltaY);
    }

    if (handle.includes('w')) {
        width = Math.max(minSize, transform.width - deltaX);
        x = transform.x + transform.width - width;
    }

    if (handle.includes('n')) {
        height = Math.max(minSize, transform.height - deltaY);
        y = transform.y + transform.height - height;
    }

    return {
        ...transform,
        x,
        y,
        width,
        height,
    };
}

function Timeline({
    composition,
    currentTime,
    selectedActionId,
    selectedLayerId,
    isPlaying,
    onPlayToggle,
    onTimeChange,
    onActionSelect,
    onActionChangeDuringInteraction,
    onInteractionStart,
    onInteractionEnd,
    onDurationChange,
}: {
    composition: Composition;
    currentTime: number;
    selectedActionId: string;
    selectedLayerId: string;
    isPlaying: boolean;
    onPlayToggle: () => void;
    onTimeChange: (timeMs: number) => void;
    onActionSelect: (actionId: string, layerId: string, source: string) => void;
    onActionChangeDuringInteraction: (
        actionId: string,
        updater: (action: AnimationAction) => AnimationAction,
    ) => void;
    onInteractionStart: () => void;
    onInteractionEnd: () => void;
    onDurationChange: (durationMs: number) => void;
}) {
    const duration = Math.max(composition.durationMs, 1);
    const playheadLeft = `${(currentTime / duration) * 100}%`;
    const ticks = Array.from({ length: 5 }, (_item, index) => {
        const timeMs = (duration / 4) * index;

        return {
            timeMs,
            left: `${(timeMs / duration) * 100}%`,
        };
    });

    function timeFromPointer(
        event: ReactPointerEvent<HTMLElement> | PointerEvent,
        element: HTMLElement,
    ): number {
        const rect = element.getBoundingClientRect();

        return clampNumber(
            ((event.clientX - rect.left) / Math.max(rect.width, 1)) * duration,
            { min: 0, max: duration },
        );
    }

    function seekFromTrack(event: ReactPointerEvent<HTMLDivElement>) {
        const target = event.target as HTMLElement | null;

        if (target?.closest('[data-timeline-action]')) {
            return;
        }

        onTimeChange(timeFromPointer(event, event.currentTarget));
    }

    function startDurationResize(event: ReactPointerEvent<HTMLButtonElement>) {
        event.preventDefault();
        event.stopPropagation();
        const track = event.currentTarget.parentElement;

        if (!track) {
            return;
        }

        const rect = track.getBoundingClientRect();
        const startPointerX = event.clientX;
        const startDuration = composition.durationMs;
        const msPerPixel = startDuration / Math.max(rect.width, 1);

        onInteractionStart();
        logEditorEvent('timeline.duration.resize_start', {
            durationMs: composition.durationMs,
        });

        function resize(pointerEvent: PointerEvent) {
            pointerEvent.preventDefault();
            onDurationChange(
                startDuration +
                    (pointerEvent.clientX - startPointerX) * msPerPixel,
            );
        }

        function stopResize() {
            window.removeEventListener('pointermove', resize);
            window.removeEventListener('pointerup', stopResize);
            window.removeEventListener('pointercancel', stopResize);
            onInteractionEnd();
            logEditorEvent('timeline.duration.resize_end', {
                durationMs: composition.durationMs,
            });
        }

        window.addEventListener('pointermove', resize);
        window.addEventListener('pointerup', stopResize, { once: true });
        window.addEventListener('pointercancel', stopResize, { once: true });
    }

    function startActionInteraction(
        event: ReactPointerEvent<HTMLElement>,
        action: AnimationAction,
        mode: 'move' | 'start' | 'end',
    ) {
        event.preventDefault();
        event.stopPropagation();
        const track = event.currentTarget.closest<HTMLElement>(
            '[data-timeline-track]',
        );

        if (!track) {
            return;
        }

        const rect = track.getBoundingClientRect();
        const startPointerX = event.clientX;
        const startMs = action.startMs;
        const startDurationMs = action.durationMs;
        const startEndMs = startMs + startDurationMs;
        const msPerPixel = duration / Math.max(rect.width, 1);

        onActionSelect(action.id, action.layerId, 'timeline');
        onInteractionStart();
        logEditorEvent('timeline.action.drag_start', {
            actionId: action.id,
            mode,
            startMs,
            durationMs: startDurationMs,
        });

        function move(pointerEvent: PointerEvent) {
            pointerEvent.preventDefault();
            const deltaMs = (pointerEvent.clientX - startPointerX) * msPerPixel;

            onActionChangeDuringInteraction(action.id, (item) => {
                if (mode === 'move') {
                    return {
                        ...item,
                        startMs: Math.round(
                            clampNumber(startMs + deltaMs, {
                                min: 0,
                                max: Math.max(0, duration - startDurationMs),
                            }),
                        ),
                    };
                }

                if (mode === 'start') {
                    const nextStart = Math.round(
                        clampNumber(startMs + deltaMs, {
                            min: 0,
                            max: startEndMs - 50,
                        }),
                    );

                    return {
                        ...item,
                        startMs: nextStart,
                        durationMs: Math.max(50, startEndMs - nextStart),
                    };
                }

                return {
                    ...item,
                    durationMs: Math.round(
                        clampNumber(startDurationMs + deltaMs, {
                            min: 50,
                            max: duration - startMs,
                        }),
                    ),
                };
            });
        }

        function stop() {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
            window.removeEventListener('pointercancel', stop);
            onInteractionEnd();
            logEditorEvent('timeline.action.drag_end', {
                actionId: action.id,
                mode,
            });
        }

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
        window.addEventListener('pointercancel', stop, { once: true });
    }

    return (
        <div className="h-64 shrink-0 border-t bg-background">
            <div className="flex items-center gap-3 border-b px-4 py-3">
                <Button type="button" size="icon" onClick={onPlayToggle}>
                    {isPlaying ? <Pause /> : <Play />}
                </Button>
                <input
                    type="range"
                    min={0}
                    max={composition.durationMs}
                    value={Math.round(currentTime)}
                    onChange={(event) =>
                        onTimeChange(Number(event.target.value))
                    }
                    className="w-full"
                />
                <span className="w-16 text-right text-sm text-muted-foreground tabular-nums">
                    {(currentTime / 1000).toFixed(1)}s
                </span>
            </div>

            <div className="grid grid-cols-[180px_minmax(0,1fr)] border-b bg-muted/30 text-xs text-muted-foreground">
                <div className="border-r px-4 py-2">Layers</div>
                <div
                    className="relative py-2"
                    data-timeline-track
                    onPointerDown={seekFromTrack}
                >
                    {ticks.map((tick) => (
                        <span
                            key={tick.timeMs}
                            className="absolute top-2 -translate-x-1/2 tabular-nums"
                            style={{ left: tick.left }}
                        >
                            {(tick.timeMs / 1000).toFixed(1)}s
                        </span>
                    ))}
                    <span
                        className="absolute top-0 h-full w-px bg-primary"
                        style={{ left: playheadLeft }}
                    />
                    <button
                        type="button"
                        aria-label="Resize scene duration"
                        title="Drag to change scene duration"
                        className="absolute top-1/2 right-0 h-5 w-2 -translate-y-1/2 rounded-full bg-border transition hover:bg-primary"
                        onPointerDown={startDurationResize}
                    />
                </div>
            </div>

            <div className="h-[172px] overflow-y-auto">
                {composition.layers.map((layer) => (
                    <div
                        key={layer.id}
                        className={`grid grid-cols-[180px_minmax(0,1fr)] border-b text-sm ${
                            layer.id === selectedLayerId ? 'bg-accent/70' : ''
                        }`}
                    >
                        <div className="truncate border-r px-4 py-2">
                            {layer.name}
                        </div>
                        <div
                            className="relative py-2"
                            data-timeline-track
                            onPointerDown={seekFromTrack}
                        >
                            <div className="h-6 rounded bg-muted" />
                            <span
                                className="pointer-events-none absolute top-0 h-full w-px bg-primary/80"
                                style={{ left: playheadLeft }}
                            />
                            {composition.actions
                                .filter((action) => action.layerId === layer.id)
                                .sort(
                                    (left, right) =>
                                        left.startMs - right.startMs,
                                )
                                .map((action) => (
                                    <button
                                        key={action.id}
                                        type="button"
                                        data-timeline-action
                                        onClick={() =>
                                            onActionSelect(
                                                action.id,
                                                layer.id,
                                                'timeline',
                                            )
                                        }
                                        onPointerDown={(event) =>
                                            startActionInteraction(
                                                event,
                                                action,
                                                'move',
                                            )
                                        }
                                        className={`absolute top-2 h-6 min-w-10 overflow-hidden rounded px-2 text-left text-xs leading-6 text-white shadow-sm transition ${
                                            action.phase === 'out'
                                                ? 'bg-rose-500'
                                                : action.phase === 'custom'
                                                  ? 'bg-amber-500'
                                                  : 'bg-sky-500'
                                        } ${
                                            selectedActionId === action.id
                                                ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                                                : 'hover:brightness-95'
                                        }`}
                                        style={{
                                            left: `${(action.startMs / duration) * 100}%`,
                                            width: `${(action.durationMs / duration) * 100}%`,
                                        }}
                                    >
                                        <span
                                            className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l bg-black/15"
                                            onPointerDown={(event) =>
                                                startActionInteraction(
                                                    event,
                                                    action,
                                                    'start',
                                                )
                                            }
                                        />
                                        {action.name}
                                        <span
                                            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r bg-black/15"
                                            onPointerDown={(event) =>
                                                startActionInteraction(
                                                    event,
                                                    action,
                                                    'end',
                                                )
                                            }
                                        />
                                    </button>
                                ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

const animationPresetGroups: Array<{
    phase: AnimationActionPhase;
    title: string;
    presets: Array<{ kind: AnimationActionKind; label: string }>;
}> = [
    {
        phase: 'in',
        title: 'In',
        presets: [
            { kind: 'fade', label: 'Fade In' },
            { kind: 'slide', label: 'Slide In' },
            { kind: 'scale', label: 'Scale In' },
            { kind: 'pop', label: 'Pop' },
            { kind: 'spin', label: 'Spin In' },
            { kind: 'float', label: 'Float In' },
        ],
    },
    {
        phase: 'custom',
        title: 'Custom',
        presets: [
            { kind: 'move', label: 'Move' },
            { kind: 'scale', label: 'Scale' },
            { kind: 'rotate', label: 'Rotate' },
            { kind: 'opacity', label: 'Opacity' },
            { kind: 'color', label: 'Color' },
            { kind: 'blur', label: 'Blur' },
            { kind: 'resize', label: 'Resize' },
            { kind: 'pulse', label: 'Pulse' },
            { kind: 'shake', label: 'Shake' },
            { kind: 'jiggle', label: 'Jiggle' },
            { kind: 'blink', label: 'Blink' },
            { kind: 'bounce', label: 'Bounce' },
            { kind: 'click', label: 'Click' },
        ],
    },
    {
        phase: 'out',
        title: 'Out',
        presets: [
            { kind: 'fade', label: 'Fade Out' },
            { kind: 'slide', label: 'Slide Out' },
            { kind: 'scale', label: 'Scale Out' },
            { kind: 'spin', label: 'Spin Out' },
        ],
    },
];

function Inspector({
    layer,
    composition,
    onCompositionChange,
    onLayerChange,
    onPreset,
    onImageUpload,
    imageUploadError,
    isImageUploading,
    onMoveLayer,
    currentTime,
    selectedActionId,
    onActionSelect,
    onActionChange,
    onActionDelete,
}: {
    layer: Layer | undefined;
    composition: Composition;
    onCompositionChange: (composition: Composition) => void;
    onLayerChange: (updater: (layer: Layer) => Layer) => void;
    onPreset: (
        preset: AnimationActionKind,
        phase?: AnimationActionPhase,
    ) => void;
    onImageUpload: (file: File) => void;
    imageUploadError: string | null;
    isImageUploading: boolean;
    onMoveLayer: (direction: 'up' | 'down') => void;
    currentTime: number;
    selectedActionId: string;
    onActionSelect: (actionId: string, layerId: string, source: string) => void;
    onActionChange: (
        actionId: string,
        updater: (action: AnimationAction) => AnimationAction,
    ) => void;
    onActionDelete: (actionId: string) => void;
}) {
    if (!layer) {
        return (
            <div className="text-sm text-muted-foreground">
                Select a layer to edit its properties.
            </div>
        );
    }

    const currentLayer = layer;
    const layerActions = composition.actions.filter(
        (action) => action.layerId === currentLayer.id,
    );
    const selectedAction =
        layerActions.find((action) => action.id === selectedActionId) ??
        layerActions[0];

    return (
        <div className="grid gap-5">
            <section className="grid gap-3">
                <h2 className="font-medium">Project</h2>
                <Field label="Width">
                    <Input
                        type="number"
                        value={composition.width}
                        onChange={(event) =>
                            onCompositionChange({
                                ...composition,
                                width: numberFromInput(
                                    event.target.value,
                                    composition.width,
                                    { min: 120, max: 7680 },
                                ),
                            })
                        }
                    />
                </Field>
                <Field label="Height">
                    <Input
                        type="number"
                        value={composition.height}
                        onChange={(event) =>
                            onCompositionChange({
                                ...composition,
                                height: numberFromInput(
                                    event.target.value,
                                    composition.height,
                                    { min: 120, max: 7680 },
                                ),
                            })
                        }
                    />
                </Field>
                <Field label="Duration ms">
                    <Input
                        type="number"
                        value={composition.durationMs}
                        onChange={(event) =>
                            onCompositionChange({
                                ...composition,
                                durationMs: numberFromInput(
                                    event.target.value,
                                    composition.durationMs,
                                    {
                                        min: minSceneDurationMs,
                                        max: maxSceneDurationMs,
                                    },
                                ),
                            })
                        }
                    />
                </Field>
                <ColorField
                    label="Background"
                    value={composition.background}
                    onChange={(background) =>
                        onCompositionChange({
                            ...composition,
                            background,
                        })
                    }
                />
            </section>

            <section className="grid gap-3">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="font-medium">Layer</h2>
                    <div className="flex gap-1">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onMoveLayer('up')}
                        >
                            Up
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onMoveLayer('down')}
                        >
                            Down
                        </Button>
                    </div>
                </div>

                <Field label="Name">
                    <Input
                        value={layer.name}
                        onChange={(event) =>
                            onLayerChange((item) => ({
                                ...item,
                                name: event.target.value,
                            }))
                        }
                    />
                </Field>

                {layer.type === 'text' && (
                    <Field label="Text">
                        <Input
                            value={layer.content ?? ''}
                            onChange={(event) =>
                                onLayerChange((item) => ({
                                    ...item,
                                    content: event.target.value,
                                }))
                            }
                        />
                    </Field>
                )}

                {layer.type === 'image' && (
                    <ImageUploadField
                        value={layer.content ?? ''}
                        error={imageUploadError}
                        isUploading={isImageUploading}
                        onUpload={onImageUpload}
                    />
                )}

                <div className="grid grid-cols-2 gap-3">
                    {(
                        [
                            'x',
                            'y',
                            'width',
                            'height',
                            'rotation',
                            'scale',
                            'opacity',
                            'blur',
                        ] as const
                    ).map((property) => (
                        <Field key={property} label={property}>
                            <Input
                                type="number"
                                step={
                                    property === 'opacity' ||
                                    property === 'scale'
                                        ? 0.1
                                        : 1
                                }
                                value={layer.transform[property] ?? 0}
                                onChange={(event) =>
                                    onLayerChange((item) => ({
                                        ...item,
                                        transform: {
                                            ...item.transform,
                                            [property]: numberFromInput(
                                                event.target.value,
                                                item.transform[property] ?? 0,
                                                transformNumberBounds(property),
                                            ),
                                        },
                                    }))
                                }
                            />
                        </Field>
                    ))}
                </div>

                <ColorField
                    label="Fill"
                    value={layer.fill}
                    onChange={(fill) =>
                        onLayerChange((item) => ({
                            ...item,
                            fill,
                        }))
                    }
                />

                <div className="grid grid-cols-2 gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                            onLayerChange((item) => ({
                                ...item,
                                hidden: !item.hidden,
                            }))
                        }
                    >
                        {layer.hidden ? <EyeOff /> : <Eye />}
                        {layer.hidden ? 'Hidden' : 'Visible'}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                            onLayerChange((item) => ({
                                ...item,
                                locked: !item.locked,
                            }))
                        }
                    >
                        {layer.locked ? <Lock /> : <Unlock />}
                        {layer.locked ? 'Locked' : 'Free'}
                    </Button>
                </div>
            </section>

            <section className="grid gap-3">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="font-medium">Actions</h2>
                    <span className="text-xs text-muted-foreground">
                        {(currentTime / 1000).toFixed(2)}s
                    </span>
                </div>
                <div className="grid gap-3">
                    {animationPresetGroups.map((group) => (
                        <div key={group.phase} className="grid gap-2">
                            <div className="text-xs font-medium text-muted-foreground uppercase">
                                {group.title}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {group.presets.map((preset) => (
                                    <Button
                                        key={`${group.phase}-${preset.kind}`}
                                        type="button"
                                        variant="outline"
                                        onClick={() =>
                                            onPreset(preset.kind, group.phase)
                                        }
                                    >
                                        {preset.label}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="grid gap-2">
                    {layerActions.map((action) => (
                        <button
                            key={action.id}
                            type="button"
                            onClick={() =>
                                onActionSelect(
                                    action.id,
                                    action.layerId,
                                    'inspector',
                                )
                            }
                            className={`grid grid-cols-[1fr_auto] items-center gap-2 rounded-md border p-2 text-left text-sm transition hover:bg-accent ${
                                selectedAction?.id === action.id
                                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                                    : ''
                            }`}
                        >
                            <span className="truncate">{action.name}</span>
                            <span className="text-xs text-muted-foreground uppercase">
                                {action.phase}
                            </span>
                        </button>
                    ))}
                    {layerActions.length === 0 && (
                        <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                            Add an action preset to build relative, reusable
                            motion.
                        </div>
                    )}
                </div>

                {selectedAction && (
                    <div className="grid gap-3 rounded-md border p-3">
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-medium">
                                    {selectedAction.name}
                                </div>
                                <div className="text-xs text-muted-foreground uppercase">
                                    {selectedAction.phase}
                                </div>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                    onActionDelete(selectedAction.id)
                                }
                                className="text-destructive hover:text-destructive"
                            >
                                <X />
                            </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <Field label="Start ms">
                                <Input
                                    type="number"
                                    value={selectedAction.startMs}
                                    onChange={(event) =>
                                        onActionChange(
                                            selectedAction.id,
                                            (action) => ({
                                                ...action,
                                                startMs: numberFromInput(
                                                    event.target.value,
                                                    action.startMs,
                                                    {
                                                        min: 0,
                                                        max: Math.max(
                                                            0,
                                                            composition.durationMs -
                                                                50,
                                                        ),
                                                    },
                                                ),
                                            }),
                                        )
                                    }
                                />
                            </Field>
                            <Field label="Duration">
                                <Input
                                    type="number"
                                    value={selectedAction.durationMs}
                                    onChange={(event) =>
                                        onActionChange(
                                            selectedAction.id,
                                            (action) => ({
                                                ...action,
                                                durationMs: numberFromInput(
                                                    event.target.value,
                                                    action.durationMs,
                                                    {
                                                        min: 50,
                                                        max: Math.max(
                                                            50,
                                                            composition.durationMs -
                                                                action.startMs,
                                                        ),
                                                    },
                                                ),
                                            }),
                                        )
                                    }
                                />
                            </Field>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <Field label="Phase">
                                <select
                                    value={selectedAction.phase}
                                    onChange={(event) =>
                                        onActionChange(
                                            selectedAction.id,
                                            (action) => ({
                                                ...action,
                                                phase: event.target
                                                    .value as AnimationActionPhase,
                                            }),
                                        )
                                    }
                                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                                >
                                    {animationPresetGroups.map((group) => (
                                        <option
                                            key={group.phase}
                                            value={group.phase}
                                        >
                                            {group.title}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Scope">
                                <select
                                    value={selectedAction.scope ?? 'layer'}
                                    onChange={(event) =>
                                        onActionChange(
                                            selectedAction.id,
                                            (action) => ({
                                                ...action,
                                                scope: event.target.value as
                                                    | 'layer'
                                                    | 'line'
                                                    | 'word'
                                                    | 'character',
                                            }),
                                        )
                                    }
                                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                                >
                                    <option value="layer">Layer</option>
                                    <option value="line">Line</option>
                                    <option value="word">Word</option>
                                    <option value="character">Character</option>
                                </select>
                            </Field>
                            <Field label="Order">
                                <select
                                    value={selectedAction.order ?? 'forward'}
                                    onChange={(event) =>
                                        onActionChange(
                                            selectedAction.id,
                                            (action) => ({
                                                ...action,
                                                order: event.target.value as
                                                    | 'forward'
                                                    | 'reverse',
                                            }),
                                        )
                                    }
                                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                                >
                                    <option value="forward">Forward</option>
                                    <option value="reverse">Reverse</option>
                                </select>
                            </Field>
                            <Field label="Stagger ms">
                                <Input
                                    type="number"
                                    value={selectedAction.staggerMs ?? 0}
                                    onChange={(event) =>
                                        onActionChange(
                                            selectedAction.id,
                                            (action) => ({
                                                ...action,
                                                staggerMs: numberFromInput(
                                                    event.target.value,
                                                    action.staggerMs ?? 0,
                                                    { min: 0, max: 5000 },
                                                ),
                                            }),
                                        )
                                    }
                                />
                            </Field>
                        </div>

                        <Field label="Easing">
                            <select
                                value={selectedAction.easing}
                                onChange={(event) =>
                                    onActionChange(
                                        selectedAction.id,
                                        (action) => ({
                                            ...action,
                                            easing: event.target
                                                .value as Easing,
                                        }),
                                    )
                                }
                                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                            >
                                {easingOptions.map((easing) => (
                                    <option key={easing} value={easing}>
                                        {easing}
                                    </option>
                                ))}
                            </select>
                        </Field>

                        <Field label="Smoothing">
                            <select
                                value={selectedAction.smoothing ?? 'ease-out'}
                                onChange={(event) =>
                                    onActionChange(
                                        selectedAction.id,
                                        (action) => ({
                                            ...action,
                                            smoothing: event.target
                                                .value as Easing,
                                        }),
                                    )
                                }
                                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                            >
                                {easingOptions.map((easing) => (
                                    <option key={easing} value={easing}>
                                        {easing}
                                    </option>
                                ))}
                            </select>
                        </Field>

                        {(selectedAction.kind === 'color' ||
                            selectedAction.color) && (
                            <ColorField
                                label="Target color"
                                value={
                                    selectedAction.color ?? currentLayer.fill
                                }
                                onChange={(color) =>
                                    onActionChange(
                                        selectedAction.id,
                                        (action) => ({
                                            ...action,
                                            color,
                                        }),
                                    )
                                }
                            />
                        )}

                        <div className="grid grid-cols-2 gap-2">
                            {actionDeltaProperties.map((property) => (
                                <Field key={property} label={property}>
                                    <Input
                                        type="number"
                                        step={
                                            property === 'opacity' ||
                                            property === 'scale'
                                                ? 0.1
                                                : 1
                                        }
                                        value={
                                            selectedAction.delta[property] ?? 0
                                        }
                                        onChange={(event) =>
                                            onActionChange(
                                                selectedAction.id,
                                                (action) => ({
                                                    ...action,
                                                    delta: {
                                                        ...action.delta,
                                                        [property]:
                                                            numberFromInput(
                                                                event.target
                                                                    .value,
                                                                action.delta[
                                                                    property
                                                                ] ?? 0,
                                                                actionDeltaNumberBounds(
                                                                    property,
                                                                ),
                                                            ),
                                                    },
                                                }),
                                            )
                                        }
                                    />
                                </Field>
                            ))}
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase">
                {label}
            </span>
            {children}
        </label>
    );
}

const colorSwatches = [
    '#111827',
    '#f8fafc',
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#22c55e',
    '#14b8a6',
    '#2563eb',
    '#7c3aed',
    '#db2777',
];

type HsvColor = {
    h: number;
    s: number;
    v: number;
};

function ColorField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const preview = isHexColor(value) ? value : '#ffffff';
    const hsv = useMemo(() => hexToHsv(value) ?? { h: 0, s: 0, v: 1 }, [value]);

    function updateFromPalette(event: ReactPointerEvent<HTMLButtonElement>) {
        const rect = event.currentTarget.getBoundingClientRect();
        const saturation = clampNumber(
            (event.clientX - rect.left) / rect.width,
            {
                min: 0,
                max: 1,
            },
        );
        const brightness =
            1 -
            clampNumber((event.clientY - rect.top) / rect.height, {
                min: 0,
                max: 1,
            });
        const nextColor = hsvToHex({
            h: hsv.h,
            s: saturation,
            v: brightness,
        });

        onChange(nextColor);
    }

    function updateFromHue(event: ReactPointerEvent<HTMLButtonElement>) {
        const rect = event.currentTarget.getBoundingClientRect();
        const hue = Math.round(
            clampNumber((event.clientX - rect.left) / rect.width, {
                min: 0,
                max: 1,
            }) * 360,
        );
        const nextColor = hsvToHex({ ...hsv, h: hue });

        onChange(nextColor);
    }

    return (
        <div className="relative grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase">
                {label}
            </span>
            <div className="flex h-9 items-center rounded-md border border-input bg-background px-2 shadow-xs">
                <button
                    type="button"
                    aria-label={`${label} color picker`}
                    onClick={() => {
                        setOpen((current) => !current);
                        logEditorEvent('color_picker.toggle', {
                            label,
                            open: !open,
                            value,
                        });
                    }}
                    className="size-5 shrink-0 rounded border shadow-inner"
                    style={{ background: preview }}
                />
                <input
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent px-2 text-sm font-medium uppercase outline-none"
                />
            </div>
            {open && (
                <div className="absolute top-full z-30 mt-2 grid w-full gap-3 rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl">
                    <button
                        type="button"
                        aria-label={`${label} saturation and brightness`}
                        className="relative h-36 overflow-hidden rounded-md border"
                        style={{
                            background: `hsl(${hsv.h} 100% 50%)`,
                        }}
                        onPointerDown={(event) => {
                            event.currentTarget.setPointerCapture(
                                event.pointerId,
                            );
                            updateFromPalette(event);
                            logEditorEvent('color_picker.palette_drag_start', {
                                label,
                                value,
                            });
                        }}
                        onPointerMove={(event) => {
                            if (event.buttons === 1) {
                                updateFromPalette(event);
                            }
                        }}
                        onPointerUp={(event) => {
                            if (
                                event.currentTarget.hasPointerCapture(
                                    event.pointerId,
                                )
                            ) {
                                event.currentTarget.releasePointerCapture(
                                    event.pointerId,
                                );
                            }

                            logEditorEvent('color_picker.palette_drag_end', {
                                label,
                                value,
                            });
                        }}
                    >
                        <span className="pointer-events-none absolute inset-0 bg-linear-to-r from-white to-white/0" />
                        <span className="pointer-events-none absolute inset-0 bg-linear-to-t from-black to-black/0" />
                        <span
                            className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                            style={{
                                left: `${hsv.s * 100}%`,
                                top: `${(1 - hsv.v) * 100}%`,
                            }}
                        />
                    </button>
                    <button
                        type="button"
                        aria-label={`${label} hue`}
                        className="relative h-4 rounded-full border"
                        style={{
                            background:
                                'linear-gradient(90deg,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)',
                        }}
                        onPointerDown={(event) => {
                            event.currentTarget.setPointerCapture(
                                event.pointerId,
                            );
                            updateFromHue(event);
                            logEditorEvent('color_picker.hue_drag_start', {
                                label,
                                value,
                            });
                        }}
                        onPointerMove={(event) => {
                            if (event.buttons === 1) {
                                updateFromHue(event);
                            }
                        }}
                        onPointerUp={(event) => {
                            if (
                                event.currentTarget.hasPointerCapture(
                                    event.pointerId,
                                )
                            ) {
                                event.currentTarget.releasePointerCapture(
                                    event.pointerId,
                                );
                            }

                            logEditorEvent('color_picker.hue_drag_end', {
                                label,
                                value,
                            });
                        }}
                    >
                        <span
                            className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                            style={{ left: `${(hsv.h / 360) * 100}%` }}
                        />
                    </button>
                    <div className="grid grid-cols-5 gap-2">
                        {colorSwatches.map((color) => (
                            <button
                                key={color}
                                type="button"
                                aria-label={color}
                                onClick={() => {
                                    onChange(color);
                                    setOpen(false);
                                }}
                                className={`h-8 rounded-md border shadow-inner transition hover:scale-105 ${
                                    value.toLowerCase() === color.toLowerCase()
                                        ? 'ring-2 ring-primary ring-offset-2 ring-offset-popover'
                                        : ''
                                }`}
                                style={{ background: color }}
                            />
                        ))}
                    </div>
                    <div className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-md bg-muted p-2">
                        <span
                            className="size-7 rounded border shadow-inner"
                            style={{ background: preview }}
                        />
                        <Input
                            value={value}
                            onChange={(event) => onChange(event.target.value)}
                            className="h-8 bg-background uppercase"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

function ImageUploadField({
    value,
    error,
    isUploading,
    onUpload,
}: {
    value: string;
    error: string | null;
    isUploading: boolean;
    onUpload: (file: File) => void;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);

    return (
        <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase">
                Image
            </span>
            <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                onChange={(event) => {
                    const file = event.target.files?.[0];

                    if (file) {
                        onUpload(file);
                    }

                    event.target.value = '';
                }}
            />
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={isUploading}
                className="grid min-h-24 place-items-center overflow-hidden rounded-lg border border-dashed bg-muted text-sm transition hover:border-primary/60 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
                {value ? (
                    <img
                        src={value}
                        alt=""
                        className="size-full max-h-36 object-cover"
                    />
                ) : (
                    <span className="font-medium text-muted-foreground">
                        {isUploading ? 'Uploading...' : 'Choose image'}
                    </span>
                )}
            </button>
            {value && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => inputRef.current?.click()}
                    disabled={isUploading}
                >
                    <Image />
                    Replace image
                </Button>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
    );
}

function isHexColor(value: string): boolean {
    return /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value);
}

function hexToHsv(value: string): HsvColor | null {
    if (!isHexColor(value)) {
        return null;
    }

    const normalized = value.slice(1, 7);
    const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
    const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
    const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let hue = 0;

    if (delta !== 0) {
        if (max === red) {
            hue = 60 * (((green - blue) / delta) % 6);
        } else if (max === green) {
            hue = 60 * ((blue - red) / delta + 2);
        } else {
            hue = 60 * ((red - green) / delta + 4);
        }
    }

    return {
        h: Math.round(hue < 0 ? hue + 360 : hue),
        s: max === 0 ? 0 : delta / max,
        v: max,
    };
}

function hsvToHex({ h, s, v }: HsvColor): string {
    const chroma = v * s;
    const huePrime = h / 60;
    const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
    const match = v - chroma;
    let red = 0;
    let green = 0;
    let blue = 0;

    if (huePrime >= 0 && huePrime < 1) {
        red = chroma;
        green = x;
    } else if (huePrime >= 1 && huePrime < 2) {
        red = x;
        green = chroma;
    } else if (huePrime >= 2 && huePrime < 3) {
        green = chroma;
        blue = x;
    } else if (huePrime >= 3 && huePrime < 4) {
        green = x;
        blue = chroma;
    } else if (huePrime >= 4 && huePrime < 5) {
        red = x;
        blue = chroma;
    } else {
        red = chroma;
        blue = x;
    }

    return `#${toHexChannel(red + match)}${toHexChannel(green + match)}${toHexChannel(blue + match)}`;
}

function toHexChannel(value: number): string {
    return Math.round(clampNumber(value, { min: 0, max: 1 }) * 255)
        .toString(16)
        .padStart(2, '0');
}

function csrfToken(): string {
    const cookie = document.cookie
        .split('; ')
        .find((item) => item.startsWith('XSRF-TOKEN='));

    return cookie ? decodeURIComponent(cookie.split('=')[1] ?? '') : '';
}

function numberFromInput(
    value: string,
    fallback: number,
    bounds: { min?: number; max?: number } = {},
): number {
    if (value.trim() === '') {
        return fallback;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return clampNumber(parsed, bounds);
}

function clampCompositionToDuration(
    composition: Composition,
    durationMs: number,
): Composition {
    const nextDuration = clampNumber(durationMs, {
        min: minSceneDurationMs,
        max: maxSceneDurationMs,
    });

    return {
        ...composition,
        durationMs: nextDuration,
        actions: composition.actions.map((action) =>
            clampActionToDuration(action, nextDuration),
        ),
    };
}

function clampActionToDuration(
    action: AnimationAction,
    durationMs: number,
): AnimationAction {
    const minimumActionDurationMs = 50;
    const startMs = Math.round(
        clampNumber(action.startMs, {
            min: 0,
            max: Math.max(0, durationMs - minimumActionDurationMs),
        }),
    );
    const durationLimit = Math.max(
        minimumActionDurationMs,
        durationMs - startMs,
    );

    return {
        ...action,
        startMs,
        durationMs: Math.round(
            clampNumber(action.durationMs, {
                min: minimumActionDurationMs,
                max: durationLimit,
            }),
        ),
    };
}

function transformNumberBounds(property: keyof Transform): {
    min?: number;
    max?: number;
} {
    if (property === 'width' || property === 'height') {
        return { min: 24, max: 7680 };
    }

    if (property === 'scale') {
        return { min: 0.1, max: 20 };
    }

    if (property === 'opacity') {
        return { min: 0, max: 1 };
    }

    if (property === 'blur') {
        return { min: 0, max: 100 };
    }

    return {};
}

function actionDeltaNumberBounds(property: AnimatedProperty): {
    min?: number;
    max?: number;
} {
    if (property === 'opacity') {
        return { min: -1, max: 1 };
    }

    if (property === 'scale') {
        return { min: -20, max: 20 };
    }

    if (property === 'width' || property === 'height') {
        return { min: -7680, max: 7680 };
    }

    if (property === 'blur') {
        return { min: -100, max: 100 };
    }

    return {};
}

function clampNumber(
    value: number,
    { min, max }: { min?: number; max?: number },
): number {
    if (min !== undefined && value < min) {
        return min;
    }

    if (max !== undefined && value > max) {
        return max;
    }

    return value;
}
