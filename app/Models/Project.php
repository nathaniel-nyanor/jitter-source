<?php

namespace App\Models;

use Database\Factories\ProjectFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'name', 'width', 'height', 'duration_ms', 'composition', 'thumbnail_path'])]
class Project extends Model
{
    /** @use HasFactory<ProjectFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<int, string>
     */
    public function uniqueIds(): array
    {
        return ['public_id'];
    }

    public function getRouteKeyName(): string
    {
        return 'public_id';
    }

    /**
     * @return array<string, array{name: string, width: int, height: int, category: string}>
     */
    public static function artboardPresets(): array
    {
        return [
            'instagram-post' => [
                'name' => 'Instagram Post',
                'width' => 1080,
                'height' => 1080,
                'category' => 'Social',
            ],
            'instagram-story' => [
                'name' => 'Instagram Story',
                'width' => 1080,
                'height' => 1920,
                'category' => 'Social',
            ],
            'desktop' => [
                'name' => 'Desktop',
                'width' => 1440,
                'height' => 1024,
                'category' => 'Screen',
            ],
            'iphone' => [
                'name' => 'iPhone',
                'width' => 390,
                'height' => 844,
                'category' => 'Mobile',
            ],
            'presentation' => [
                'name' => 'Presentation',
                'width' => 1920,
                'height' => 1080,
                'category' => 'Video',
            ],
            'wide-video' => [
                'name' => 'Wide Video',
                'width' => 1280,
                'height' => 720,
                'category' => 'Video',
            ],
        ];
    }

    /**
     * @return array{name: string, width: int, height: int, category: string}
     */
    public static function artboardPreset(string $key): array
    {
        return self::artboardPresets()[$key];
    }

    /**
     * @return BelongsTo<User, Project>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'composition' => 'array',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function defaultComposition(
        string $name = 'Untitled Motion',
        int $width = 1080,
        int $height = 1080,
    ): array {
        $titleWidth = min(720, max(240, $width - 160));
        $titleHeight = 100;

        return [
            'version' => '0.1.0',
            'name' => $name,
            'width' => $width,
            'height' => $height,
            'durationMs' => 4000,
            'background' => '#f8fafc',
            'layers' => [
                [
                    'id' => 'layer-title',
                    'type' => 'text',
                    'name' => 'Title',
                    'content' => 'Motion starts here',
                    'fill' => '#111827',
                    'fontSize' => 72,
                    'fontWeight' => 700,
                    'transform' => [
                        'x' => max(40, (int) (($width - $titleWidth) / 2)),
                        'y' => max(40, (int) (($height - $titleHeight) / 2)),
                        'width' => $titleWidth,
                        'height' => $titleHeight,
                        'rotation' => 0,
                        'scale' => 1,
                        'opacity' => 1,
                        'blur' => 0,
                    ],
                    'hidden' => false,
                    'locked' => false,
                ],
            ],
            'actions' => [
                [
                    'id' => 'action-title-slide-in',
                    'layerId' => 'layer-title',
                    'name' => 'Slide In',
                    'kind' => 'slide',
                    'phase' => 'in',
                    'startMs' => 0,
                    'durationMs' => 900,
                    'easing' => 'ease-out',
                    'delta' => ['y' => 80, 'opacity' => -1],
                    'scope' => 'layer',
                    'order' => 'forward',
                    'staggerMs' => 0,
                    'smoothing' => 'ease-out',
                ],
            ],
        ];
    }
}
