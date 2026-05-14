<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->ulid('public_id')->nullable()->after('id');
        });

        foreach (DB::table('projects')->whereNull('public_id')->lazyById() as $project) {
            DB::table('projects')
                ->where('id', $project->id)
                ->update(['public_id' => (string) Str::ulid()]);
        }

        Schema::table('projects', function (Blueprint $table) {
            $table->unique('public_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->dropUnique(['public_id']);
            $table->dropColumn('public_id');
        });
    }
};
