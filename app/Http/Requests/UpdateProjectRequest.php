<?php

namespace App\Http\Requests;

use App\Models\Project;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpdateProjectRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        $project = $this->route('project');

        return $project instanceof Project && ($this->user()?->can('update', $project) ?? false);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'composition' => ['sometimes', 'required', 'array'],
            'composition.version' => ['required_with:composition', 'string', 'max:20'],
            'composition.name' => ['required_with:composition', 'string', 'max:120'],
            'composition.width' => ['required_with:composition', 'integer', 'min:120', 'max:7680'],
            'composition.height' => ['required_with:composition', 'integer', 'min:120', 'max:7680'],
            'composition.durationMs' => ['required_with:composition', 'integer', 'min:100', 'max:120000'],
            'composition.background' => ['required_with:composition', 'string', 'max:32'],
            'composition.layers' => ['required_with:composition', 'array', 'max:200'],
            'composition.actions' => ['required_with:composition', 'array', 'max:1000'],
        ];
    }
}
