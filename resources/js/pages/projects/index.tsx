import { Form, Head, Link, router, useForm } from '@inertiajs/react';
import {
    Copy,
    Download,
    Film,
    Monitor,
    Plus,
    Smartphone,
    Trash2,
} from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import {
    destroy,
    download,
    duplicate,
    show,
    store,
} from '@/actions/App/Http/Controllers/ProjectController';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { logEditorEvent } from '@/lib/editor-logger';
import { index as projectsIndex } from '@/routes/projects';
import type { ArtboardPreset, ProjectSummary } from '@/types';

export default function ProjectsIndex({
    artboards,
    projects,
}: {
    artboards: ArtboardPreset[];
    projects: ProjectSummary[];
}) {
    const form = useForm({ name: 'Untitled Motion', artboard: '' });
    const [createDialogOpen, setCreateDialogOpen] = useState(false);

    function createProject(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        logEditorEvent('project.create.requested', form.data);
        form.post(store.url(), {
            onError: (errors) => {
                logEditorEvent('project.create.failed', { errors });
                setCreateDialogOpen(true);
            },
            onSuccess: () => {
                logEditorEvent('project.create.succeeded', form.data);
                setCreateDialogOpen(false);
            },
        });
    }

    return (
        <>
            <Head title="Projects" />
            <div className="flex h-full flex-1 flex-col gap-6 overflow-x-auto p-4">
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                    <div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Film className="size-4" />
                            Motion workspace
                        </div>
                        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                            Projects
                        </h1>
                    </div>

                    <Button
                        type="button"
                        onClick={() => {
                            logEditorEvent('project.create_modal.opened');
                            setCreateDialogOpen(true);
                        }}
                    >
                        <Plus />
                        New project
                    </Button>
                </div>

                <Dialog
                    open={createDialogOpen}
                    onOpenChange={setCreateDialogOpen}
                >
                    <DialogContent className="sm:max-w-3xl">
                        <DialogHeader>
                            <DialogTitle>New project</DialogTitle>
                            <DialogDescription>
                                Choose the artboard size before opening the
                                editor.
                            </DialogDescription>
                        </DialogHeader>

                        <form onSubmit={createProject} className="grid gap-5">
                            <div className="grid gap-1.5">
                                <Label htmlFor="project-name">Name</Label>
                                <Input
                                    id="project-name"
                                    value={form.data.name}
                                    onChange={(event) =>
                                        form.setData('name', event.target.value)
                                    }
                                />
                                {form.errors.name && (
                                    <p className="text-sm text-destructive">
                                        {form.errors.name}
                                    </p>
                                )}
                            </div>

                            <div className="grid gap-2">
                                <Label>Artboard</Label>
                                <div className="grid max-h-[48vh] grid-cols-2 gap-2 overflow-y-auto pr-1 lg:grid-cols-3">
                                    {artboards.map((artboard) => (
                                        <button
                                            key={artboard.id}
                                            type="button"
                                            onClick={() => {
                                                form.setData(
                                                    'artboard',
                                                    artboard.id,
                                                );
                                                logEditorEvent(
                                                    'project.artboard.selected',
                                                    {
                                                        artboard,
                                                    },
                                                );
                                            }}
                                            className={`grid gap-2 rounded-lg border p-3 text-left transition hover:border-primary/60 hover:bg-accent ${
                                                form.data.artboard ===
                                                artboard.id
                                                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                                                    : 'border-border bg-background'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-sm font-medium">
                                                    {artboard.name}
                                                </span>
                                                {artboard.category ===
                                                'Mobile' ? (
                                                    <Smartphone className="size-4 text-muted-foreground" />
                                                ) : (
                                                    <Monitor className="size-4 text-muted-foreground" />
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className="block rounded-sm border bg-muted"
                                                    style={artboardPreviewStyle(
                                                        artboard,
                                                    )}
                                                />
                                                <span className="text-xs text-muted-foreground">
                                                    {artboard.width} x{' '}
                                                    {artboard.height}
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                                {form.errors.artboard && (
                                    <p className="text-sm text-destructive">
                                        {form.errors.artboard}
                                    </p>
                                )}
                            </div>

                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                        logEditorEvent(
                                            'project.create_modal.closed',
                                        );
                                        setCreateDialogOpen(false);
                                    }}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={
                                        form.processing || !form.data.artboard
                                    }
                                >
                                    <Plus />
                                    Create project
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {projects.map((project) => (
                        <article
                            key={project.id}
                            className="group overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs"
                        >
                            <Link
                                href={show(project.id)}
                                className="block aspect-video bg-muted"
                            >
                                <div className="flex size-full items-center justify-center bg-[linear-gradient(135deg,#f8fafc,#e2e8f0)] text-muted-foreground dark:bg-[linear-gradient(135deg,#18181b,#27272a)]">
                                    <Film className="size-8" />
                                </div>
                            </Link>

                            <div className="flex items-start justify-between gap-3 p-4">
                                <div className="min-w-0">
                                    <Link
                                        href={show(project.id)}
                                        className="block truncate font-medium hover:underline"
                                    >
                                        {project.name}
                                    </Link>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {project.width} x {project.height} ·{' '}
                                        {(project.durationMs / 1000).toFixed(1)}
                                        s
                                    </p>
                                </div>

                                <div className="flex shrink-0 items-center gap-1">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() =>
                                            router.post(
                                                duplicate(project.id).url,
                                            )
                                        }
                                        title="Duplicate"
                                    >
                                        <Copy />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        asChild
                                        title="Download JSON"
                                    >
                                        <a href={download(project.id).url}>
                                            <Download />
                                        </a>
                                    </Button>
                                    <Form
                                        action={destroy(project.id).url}
                                        method="delete"
                                    >
                                        {({ processing }) => (
                                            <Button
                                                type="submit"
                                                variant="ghost"
                                                size="icon"
                                                disabled={processing}
                                                title="Delete"
                                                className="text-destructive hover:text-destructive"
                                            >
                                                <Trash2 />
                                            </Button>
                                        )}
                                    </Form>
                                </div>
                            </div>
                        </article>
                    ))}
                </div>

                {projects.length === 0 && (
                    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed text-center">
                        <Film className="size-9 text-muted-foreground" />
                        <h2 className="mt-3 font-medium">No projects yet</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Create the first motion project to open the editor.
                        </p>
                    </div>
                )}
            </div>
        </>
    );
}

ProjectsIndex.layout = {
    breadcrumbs: [
        {
            title: 'Projects',
            href: projectsIndex(),
        },
    ],
};

function artboardPreviewStyle(artboard: ArtboardPreset) {
    const maxWidth = 28;
    const maxHeight = 22;
    const ratio = artboard.width / artboard.height;

    if (ratio >= 1) {
        return {
            width: maxWidth,
            height: Math.max(10, maxWidth / ratio),
        };
    }

    return {
        width: Math.max(10, maxHeight * ratio),
        height: maxHeight,
    };
}
