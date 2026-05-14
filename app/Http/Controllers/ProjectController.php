<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreProjectRequest;
use App\Http\Requests\UpdateProjectRequest;
use App\Http\Requests\UploadProjectImageRequest;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

class ProjectController extends Controller
{
    public function index(Request $request): Response
    {
        Gate::authorize('viewAny', Project::class);

        return Inertia::render('projects/index', [
            'artboards' => collect(Project::artboardPresets())
                ->map(fn (array $preset, string $id): array => [
                    'id' => $id,
                    'name' => $preset['name'],
                    'width' => $preset['width'],
                    'height' => $preset['height'],
                    'category' => $preset['category'],
                ])
                ->values(),
            'projects' => $request->user()->projects()
                ->latest('updated_at')
                ->get(['id', 'public_id', 'name', 'width', 'height', 'duration_ms', 'thumbnail_path', 'updated_at'])
                ->map(fn (Project $project): array => [
                    'id' => $project->getRouteKey(),
                    'name' => $project->name,
                    'width' => $project->width,
                    'height' => $project->height,
                    'durationMs' => $project->duration_ms,
                    'thumbnailPath' => $project->thumbnail_path,
                    'updatedAt' => $project->updated_at?->toIso8601String(),
                ]),
        ]);
    }

    public function store(StoreProjectRequest $request): RedirectResponse
    {
        $name = $request->validated('name') ?: 'Untitled Motion';
        $artboard = Project::artboardPreset($request->validated('artboard'));

        $project = $request->user()->projects()->create([
            'name' => $name,
            'width' => $artboard['width'],
            'height' => $artboard['height'],
            'duration_ms' => 4000,
            'composition' => Project::defaultComposition($name, $artboard['width'], $artboard['height']),
        ]);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Project created.')]);

        return to_route('projects.show', $project);
    }

    public function show(Project $project): Response
    {
        Gate::authorize('view', $project);

        return Inertia::render('projects/editor', [
            'project' => [
                'id' => $project->getRouteKey(),
                'name' => $project->name,
                'width' => $project->width,
                'height' => $project->height,
                'durationMs' => $project->duration_ms,
                'composition' => $project->composition,
                'updatedAt' => $project->updated_at?->toIso8601String(),
            ],
        ]);
    }

    public function update(UpdateProjectRequest $request, Project $project): RedirectResponse
    {
        $validated = $request->validated();

        if (array_key_exists('name', $validated)) {
            $project->name = $validated['name'];
        }

        if (array_key_exists('composition', $validated)) {
            $composition = $validated['composition'];

            $project->fill([
                'name' => $composition['name'],
                'width' => $composition['width'],
                'height' => $composition['height'],
                'duration_ms' => $composition['durationMs'],
                'composition' => $composition,
            ]);
        }

        $project->save();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Project saved.')]);

        return to_route('projects.show', $project);
    }

    public function destroy(Project $project): RedirectResponse
    {
        Gate::authorize('delete', $project);

        $project->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Project deleted.')]);

        return to_route('projects.index');
    }

    public function duplicate(Request $request, Project $project): RedirectResponse
    {
        Gate::authorize('view', $project);

        $name = Str::limit($project->name.' Copy', 120, '');
        $composition = $project->composition;
        $composition['name'] = $name;

        $copy = $request->user()->projects()->create([
            'name' => $name,
            'width' => $project->width,
            'height' => $project->height,
            'duration_ms' => $project->duration_ms,
            'composition' => $composition,
            'thumbnail_path' => $project->thumbnail_path,
        ]);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Project duplicated.')]);

        return to_route('projects.show', $copy);
    }

    public function uploadImage(UploadProjectImageRequest $request, Project $project): JsonResponse
    {
        $path = $request
            ->file('image')
            ->store('project-images/'.$project->getRouteKey(), 'public');

        return response()->json([
            'url' => '/storage/'.$path,
        ]);
    }

    public function download(Project $project): JsonResponse
    {
        Gate::authorize('view', $project);

        $filename = Str::slug($project->name).'.motion.json';

        return response()
            ->json($project->composition, 200, [
                'Content-Disposition' => 'attachment; filename="'.$filename.'"',
            ]);
    }
}
