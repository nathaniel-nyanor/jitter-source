<?php

use App\Models\Project;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function () {
    $this->withoutVite();
});

test('guests cannot access projects', function () {
    $this->get(route('projects.index'))->assertRedirect(route('login'));
});

test('authenticated users can create and open a project', function () {
    $user = User::factory()->create();

    $response = $this
        ->actingAs($user)
        ->post(route('projects.store'), [
            'name' => 'Launch Animation',
            'artboard' => 'iphone',
        ]);

    $project = Project::query()->firstOrFail();

    $response
        ->assertSessionHasNoErrors()
        ->assertRedirect(route('projects.show', $project));

    expect($project->user_id)->toBe($user->id)
        ->and($project->public_id)->toBeString()
        ->and($project->public_id)->toHaveLength(26)
        ->and($project->name)->toBe('Launch Animation')
        ->and($project->width)->toBe(390)
        ->and($project->height)->toBe(844)
        ->and($project->duration_ms)->toBe(4000)
        ->and($project->composition['name'])->toBe('Launch Animation')
        ->and($project->composition['width'])->toBe(390)
        ->and($project->composition['height'])->toBe(844)
        ->and($project->composition['durationMs'])->toBe(4000)
        ->and($project->composition['layers'][0]['transform']['blur'])->toBe(0)
        ->and($project->composition)->not->toHaveKey('tracks')
        ->and($project->composition['actions'])->toHaveCount(1)
        ->and($project->composition['actions'][0]['kind'])->toBe('slide')
        ->and($project->composition['actions'][0]['order'])->toBe('forward')
        ->and($project->composition['actions'][0]['staggerMs'])->toBe(0)
        ->and($project->composition['actions'][0]['smoothing'])->toBe('ease-out')
        ->and($project->composition['actions'][0]['delta'])->toMatchArray([
            'y' => 80,
            'opacity' => -1,
        ]);

    $this
        ->actingAs($user)
        ->get(route('projects.show', $project))
        ->assertOk();
});

test('project creation requires an artboard preset', function () {
    $user = User::factory()->create();

    $this
        ->actingAs($user)
        ->post(route('projects.store'), [
            'name' => 'No Frame',
        ])
        ->assertSessionHasErrors('artboard');

    $this
        ->actingAs($user)
        ->post(route('projects.store'), [
            'name' => 'Bad Frame',
            'artboard' => 'billboard',
        ])
        ->assertSessionHasErrors('artboard');
});

test('projects use public ids for routes and client props', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();
    $path = parse_url(route('projects.show', $project), PHP_URL_PATH);

    expect($project->getRouteKeyName())->toBe('public_id')
        ->and($project->getRouteKey())->toBe($project->public_id)
        ->and($path)->toBe('/projects/'.$project->public_id)
        ->and($path)->not->toBe('/projects/'.$project->getKey());

    $this
        ->actingAs($user)
        ->get('/projects/'.$project->getKey())
        ->assertNotFound();

    $this
        ->actingAs($user)
        ->get(route('projects.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->component('projects/index')
            ->where('projects.0.id', $project->public_id)
        );

    $this
        ->actingAs($user)
        ->get(route('projects.show', $project))
        ->assertInertia(fn (Assert $page) => $page
            ->component('projects/editor')
            ->where('project.id', $project->public_id)
        );
});

test('users only see their own projects', function () {
    $user = User::factory()->create();
    $otherUser = User::factory()->create();
    $ownProject = Project::factory()->for($user)->create(['name' => 'Mine']);
    $otherProject = Project::factory()->for($otherUser)->create(['name' => 'Theirs']);

    $response = $this
        ->actingAs($user)
        ->get(route('projects.index'));

    $response
        ->assertOk()
        ->assertSee($ownProject->name)
        ->assertDontSee($otherProject->name);
});

test('users cannot access or mutate another users project', function () {
    $user = User::factory()->create();
    $otherUser = User::factory()->create();
    $project = Project::factory()->for($otherUser)->create();

    $this
        ->actingAs($user)
        ->get(route('projects.show', $project))
        ->assertForbidden();

    $this
        ->actingAs($user)
        ->patch(route('projects.update', $project), [
            'name' => 'Stolen',
        ])
        ->assertForbidden();

    $this
        ->actingAs($user)
        ->delete(route('projects.destroy', $project))
        ->assertForbidden();

    $this
        ->actingAs($user)
        ->post(route('projects.images.store', $project), [
            'image' => UploadedFile::fake()->image('stolen.png'),
        ], ['Accept' => 'application/json'])
        ->assertForbidden();
});

test('project images can be uploaded by their owner', function () {
    Storage::fake('public');

    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $response = $this
        ->actingAs($user)
        ->post(route('projects.images.store', $project), [
            'image' => UploadedFile::fake()->image('layer.png', 600, 400),
        ], ['Accept' => 'application/json']);

    $response
        ->assertOk()
        ->assertJsonStructure(['url']);

    $files = Storage::disk('public')->files('project-images/'.$project->getRouteKey());

    expect($response->json('url'))->toContain('/storage/project-images/'.$project->getRouteKey().'/');

    expect($files)->toHaveCount(1);

    Storage::disk('public')->assertExists($files[0]);
});

test('project composition can be saved and exported as json', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();
    $composition = Project::defaultComposition('Updated Motion');
    $composition['width'] = 1920;
    $composition['height'] = 1080;
    $composition['durationMs'] = 7000;
    $composition['actions'] = [
        [
            'id' => 'action-fade-in',
            'layerId' => 'layer-title',
            'name' => 'Fade In',
            'kind' => 'fade',
            'phase' => 'in',
            'startMs' => 0,
            'durationMs' => 800,
            'easing' => 'ease-out',
            'delta' => ['opacity' => -1],
            'scope' => 'layer',
        ],
    ];

    $response = $this
        ->actingAs($user)
        ->patch(route('projects.update', $project), [
            'composition' => $composition,
        ]);

    $response
        ->assertSessionHasNoErrors()
        ->assertRedirect(route('projects.show', $project));

    $project->refresh();

    expect($project->name)->toBe('Updated Motion')
        ->and($project->width)->toBe(1920)
        ->and($project->height)->toBe(1080)
        ->and($project->duration_ms)->toBe(7000)
        ->and($project->composition['durationMs'])->toBe(7000)
        ->and($project->composition['actions'])->toHaveCount(1);

    $this
        ->actingAs($user)
        ->get(route('projects.export', $project))
        ->assertOk()
        ->assertHeader('Content-Disposition', 'attachment; filename="updated-motion.motion.json"')
        ->assertJsonPath('name', 'Updated Motion');
});

test('invalid composition payloads are rejected', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this
        ->actingAs($user)
        ->from(route('projects.show', $project))
        ->patch(route('projects.update', $project), [
            'composition' => 'not-json',
        ])
        ->assertSessionHasErrors('composition')
        ->assertRedirect(route('projects.show', $project));

    $composition = Project::defaultComposition('Too Long');
    $composition['durationMs'] = 120001;

    $this
        ->actingAs($user)
        ->from(route('projects.show', $project))
        ->patch(route('projects.update', $project), [
            'composition' => $composition,
        ])
        ->assertSessionHasErrors('composition.durationMs')
        ->assertRedirect(route('projects.show', $project));
});

test('projects can be duplicated and deleted by their owner', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create(['name' => 'Original']);

    $response = $this
        ->actingAs($user)
        ->post(route('projects.duplicate', $project));

    $copy = Project::query()
        ->where('name', 'Original Copy')
        ->firstOrFail();

    $response
        ->assertSessionHasNoErrors()
        ->assertRedirect(route('projects.show', $copy));

    expect($copy->user_id)->toBe($user->id);

    $this
        ->actingAs($user)
        ->delete(route('projects.destroy', $project))
        ->assertRedirect(route('projects.index'));

    expect($project->fresh())->toBeNull();
});
