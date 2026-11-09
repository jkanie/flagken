// Generated from openapi.json by scripts/generate.mjs. Do not edit: run `pnpm api:generate`.

export interface paths {
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["Auth_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["Auth_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Auth_me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Projects_list"];
        put?: never;
        post: operations["Projects_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project}/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Audit_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project}/environments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["Projects_createEnvironment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project}/environments/{environment}/api-keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Projects_listApiKeys"];
        put?: never;
        post: operations["Projects_createApiKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project}/environments/{environment}/api-keys/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["Projects_revokeApiKey"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project}/flags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Flags_list"];
        put?: never;
        post: operations["Flags_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project}/flags/{flag}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Flags_get"];
        put: operations["Flags_update"];
        post?: never;
        delete: operations["Flags_archive"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project}/flags/{flag}/environments/{environment}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Flags_getState"];
        put: operations["Flags_updateState"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project}/flags/{flag}/environments/{environment}/kill": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["Flags_kill"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project}/flags/{flag}/environments/{environment}/schedules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Schedules_list"];
        put?: never;
        post: operations["Schedules_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project}/flags/{flag}/environments/{environment}/schedules/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["Schedules_cancel"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project}/webhooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Webhooks_list"];
        put?: never;
        post: operations["Webhooks_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project}/webhooks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["Webhooks_update"];
        post?: never;
        delete: operations["Webhooks_remove"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project}/webhooks/{id}/deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Webhooks_deliveries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{project}/webhooks/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["Webhooks_test"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Users_list"];
        put?: never;
        post: operations["Users_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["Users_update"];
        trace?: never;
    };
    "/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Health_liveness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Health_readiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sdk/v1/evaluate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["Sdk_evaluate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sdk/v1/flags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Sdk_all"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sdk/v1/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["Sdk_stream"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ApiKeyDto: {
            createdAt: string;
            id: string;
            kind: components["schemas"]["ApiKeyKind"];
            name: string;
            /** @description First characters of the key. */
            prefix: string;
            revokedAt: string | null;
        };
        /** @enum {string} */
        ApiKeyKind: "server" | "client";
        AuditActorDto: {
            label: string;
            /** @enum {string} */
            type: "user" | "api_key" | "system";
        };
        AuditEntryDto: {
            action: string;
            actor: components["schemas"]["AuditActorDto"];
            /** @description Any JSON value. */
            after: (string | number | boolean | {
                [key: string]: unknown;
            } | unknown[]) | null;
            at: string;
            /** @description Any JSON value. */
            before: (string | number | boolean | {
                [key: string]: unknown;
            } | unknown[]) | null;
            environment: string | null;
            id: string;
            resourceKey: string;
            resourceType: string;
        };
        ClauseDto: {
            /** @example country */
            attribute: string;
            negate?: boolean;
            op: components["schemas"]["ClauseOp"];
            values: (string | number | boolean)[];
        };
        /** @enum {string} */
        ClauseOp: "in" | "contains" | "startsWith" | "endsWith" | "lt" | "lte" | "gt" | "gte" | "before" | "after";
        CreateApiKeyDto: {
            kind: components["schemas"]["ApiKeyKind"];
            name: string;
        };
        CreatedApiKeyDto: {
            createdAt: string;
            id: string;
            /** @description The whole key. Shown once, never stored. */
            key: string;
            kind: components["schemas"]["ApiKeyKind"];
            name: string;
            /** @description First characters of the key. */
            prefix: string;
            revokedAt: string | null;
        };
        CreatedWebhookDto: {
            active: boolean;
            createdAt: string;
            events: ("*" | "flag.created" | "flag.updated" | "flag.archived" | "flag.state.updated" | "flag.killed" | "flag.unkilled" | "flag.schedule.created" | "flag.schedule.cancelled" | "flag.schedule.executed")[];
            id: string;
            name: string;
            /** @description HMAC-SHA256 signing secret. Shown once. */
            secret: string;
            url: string;
        };
        CreateEnvironmentDto: {
            key: string;
            name: string;
        };
        CreateFlagDto: {
            description?: string;
            key: string;
            kind: components["schemas"]["FlagKind"];
            name: string;
            tags?: string[];
            variations: components["schemas"]["VariationDto"][];
        };
        CreateProjectDto: {
            key: string;
            name: string;
        };
        CreateScheduleDto: {
            change: components["schemas"]["ScheduledChangeBodyDto"];
            /** Format: date-time */
            runAt: string;
        };
        CreateUserDto: {
            email: string;
            password: string;
            role: components["schemas"]["Role"];
        };
        CreateWebhookDto: {
            events: ("*" | "flag.created" | "flag.updated" | "flag.archived" | "flag.state.updated" | "flag.killed" | "flag.unkilled" | "flag.schedule.created" | "flag.schedule.cancelled" | "flag.schedule.executed")[];
            name: string;
            /** @example https://hooks.example.com/flagken */
            url: string;
        };
        EnvironmentDto: {
            key: string;
            name: string;
        };
        EvalContextDto: {
            /**
             * @description Attributes rules can match on.
             * @example {
             *       "country": "CA",
             *       "plan": "beta"
             *     }
             */
            attributes?: {
                [key: string]: unknown;
            };
            /**
             * @description Opaque id for the user or device. Never a name or e-mail address.
             * @example u_7f3a9c
             */
            key: string;
        };
        EvalReasonDto: {
            bucket?: number;
            /** @enum {string} */
            errorKind?: "FLAG_NOT_FOUND" | "MALFORMED_FLAG";
            /** @enum {string} */
            kind: "OFF" | "KILLED" | "TARGET_MATCH" | "RULE_MATCH" | "FALLTHROUGH" | "ERROR";
            ruleId?: string;
            ruleIndex?: number;
        };
        EvaluatedFlagDto: {
            key: string;
            reason: components["schemas"]["EvalReasonDto"];
            /** @description Any JSON value. */
            value: (string | number | boolean | {
                [key: string]: unknown;
            } | unknown[]) | null;
            variation: number | null;
            version: number;
        };
        FlagConfigDto: {
            fallthrough: components["schemas"]["ServeVariationDto"] | components["schemas"]["ServeRolloutDto"];
            key: string;
            killed: boolean;
            kind: components["schemas"]["FlagKind"];
            offVariation: number;
            on: boolean;
            rules: components["schemas"]["RuleDto"][];
            targets: components["schemas"]["TargetDto"][];
            variations: components["schemas"]["VariationDto"][];
            version: number;
        };
        FlagDto: {
            archived: boolean;
            createdAt: string;
            description: string;
            key: string;
            kind: components["schemas"]["FlagKind"];
            name: string;
            tags: string[];
            updatedAt: string;
            variations: components["schemas"]["VariationDto"][];
            version: number;
        };
        /** @enum {string} */
        FlagKind: "boolean" | "string" | "number" | "json";
        FlagListItemDto: {
            archived: boolean;
            createdAt: string;
            description: string;
            key: string;
            kind: components["schemas"]["FlagKind"];
            name: string;
            state: components["schemas"]["FlagStateSummaryDto"];
            tags: string[];
            updatedAt: string;
            variations: components["schemas"]["VariationDto"][];
            version: number;
        };
        FlagStateDto: {
            environment: string;
            fallthrough: components["schemas"]["ServeVariationDto"] | components["schemas"]["ServeRolloutDto"];
            killed: boolean;
            offVariation: number;
            on: boolean;
            rules: components["schemas"]["RuleDto"][];
            targets: components["schemas"]["TargetDto"][];
            updatedAt: string;
            version: number;
        };
        FlagStateSummaryDto: {
            killed: boolean;
            on: boolean;
            rules: number;
            version: number;
        };
        KillDto: {
            killed: boolean;
        };
        LoginDto: {
            /** @example owner@example.com */
            email: string;
            password: string;
        };
        MeDto: {
            email: string;
            id: string;
            role: components["schemas"]["Role"];
        };
        ProjectDto: {
            environments: components["schemas"]["EnvironmentDto"][];
            key: string;
            name: string;
        };
        /** @enum {string} */
        Role: "owner" | "editor" | "viewer";
        RolloutDto: {
            /** @description Context attribute to bucket by. Defaults to key. */
            bucketBy?: string;
            variations: components["schemas"]["WeightedVariationDto"][];
        };
        RuleDto: {
            clauses: components["schemas"]["ClauseDto"][];
            description?: string;
            id: string;
            serve: components["schemas"]["ServeVariationDto"] | components["schemas"]["ServeRolloutDto"];
        };
        ScheduledChangeBodyDto: {
            fallthrough?: components["schemas"]["ServeVariationDto"] | components["schemas"]["ServeRolloutDto"];
            on?: boolean;
        };
        ScheduledChangeDto: {
            change: components["schemas"]["ScheduledChangeBodyDto"];
            environment: string;
            error: string | null;
            executedAt: string | null;
            id: string;
            /** Format: date-time */
            runAt: string;
            /** @enum {string} */
            status: "pending" | "done" | "failed" | "cancelled";
        };
        SdkEvaluationDto: {
            environment: string;
            flags: components["schemas"]["EvaluatedFlagDto"][];
        };
        SdkFlagsDto: {
            environment: string;
            flags: components["schemas"]["FlagConfigDto"][];
        };
        ServeRolloutDto: {
            rollout: components["schemas"]["RolloutDto"];
        };
        ServeVariationDto: {
            variation: number;
        };
        TargetDto: {
            values: string[];
            variation: number;
        };
        UpdateFlagDto: {
            description: string;
            name: string;
            tags: string[];
            variations: components["schemas"]["VariationDto"][];
        };
        UpdateFlagStateDto: {
            fallthrough: components["schemas"]["ServeVariationDto"] | components["schemas"]["ServeRolloutDto"];
            offVariation: number;
            on: boolean;
            rules: components["schemas"]["RuleDto"][];
            targets: components["schemas"]["TargetDto"][];
        };
        UpdateUserDto: {
            disabled?: boolean;
            role?: components["schemas"]["Role"];
        };
        UpdateWebhookDto: {
            active: boolean;
            events: ("*" | "flag.created" | "flag.updated" | "flag.archived" | "flag.state.updated" | "flag.killed" | "flag.unkilled" | "flag.schedule.created" | "flag.schedule.cancelled" | "flag.schedule.executed")[];
            name: string;
            /** @example https://hooks.example.com/flagken */
            url: string;
        };
        UserDto: {
            createdAt: string;
            disabled: boolean;
            email: string;
            id: string;
            role: components["schemas"]["Role"];
        };
        VariationDto: {
            description?: string;
            name?: string;
            /** @description Any JSON value. */
            value: (string | number | boolean | {
                [key: string]: unknown;
            } | unknown[]) | null;
        };
        WebhookDeliveryDto: {
            attempt: number;
            createdAt: string;
            durationMs: number;
            error: string | null;
            eventId: string;
            eventType: string;
            id: string;
            ok: boolean;
            statusCode: number | null;
        };
        WebhookDto: {
            active: boolean;
            createdAt: string;
            events: ("*" | "flag.created" | "flag.updated" | "flag.archived" | "flag.state.updated" | "flag.killed" | "flag.unkilled" | "flag.schedule.created" | "flag.schedule.cancelled" | "flag.schedule.executed")[];
            id: string;
            name: string;
            url: string;
        };
        WebhookTestDto: {
            eventId: string;
        };
        WeightedVariationDto: {
            variation: number;
            /** @description Share of 10,000 buckets. */
            weight: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    Auth_login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeDto"];
                };
            };
        };
    };
    Auth_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    Auth_me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeDto"];
                };
            };
        };
    };
    Projects_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectDto"][];
                };
            };
        };
    };
    Projects_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateProjectDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectDto"];
                };
            };
        };
    };
    Audit_list: {
        parameters: {
            query?: {
                /** @description Entry id: list entries older than this one. */
                before?: unknown;
                environment?: unknown;
                flag?: unknown;
                limit?: number;
            };
            header?: never;
            path: {
                project: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEntryDto"][];
                };
            };
        };
    };
    Projects_createEnvironment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateEnvironmentDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvironmentDto"];
                };
            };
        };
    };
    Projects_listApiKeys: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                environment: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyDto"][];
                };
            };
        };
    };
    Projects_createApiKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                environment: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateApiKeyDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedApiKeyDto"];
                };
            };
        };
    };
    Projects_revokeApiKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                environment: string;
                id: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    Flags_list: {
        parameters: {
            query: {
                environment: string;
                /** @description Search in key, name and description. */
                q?: unknown;
            };
            header?: never;
            path: {
                project: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FlagListItemDto"][];
                };
            };
        };
    };
    Flags_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateFlagDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FlagDto"];
                };
            };
        };
    };
    Flags_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                flag: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Version of the flag. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FlagDto"];
                };
            };
        };
    };
    Flags_update: {
        parameters: {
            query?: never;
            header: {
                /** @description ETag from your last read. A stale value gets 412. */
                "If-Match": string;
            };
            path: {
                flag: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateFlagDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FlagDto"];
                };
            };
            /** @description Someone saved a newer version first. */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description If-Match is missing. */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    Flags_archive: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                flag: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The flag is archived. SDKs stop seeing it. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    Flags_getState: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                environment: string;
                flag: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Version of this state. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FlagStateDto"];
                };
            };
        };
    };
    Flags_updateState: {
        parameters: {
            query?: never;
            header: {
                /** @description ETag from your last read. A stale value gets 412. */
                "If-Match": string;
            };
            path: {
                environment: string;
                flag: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateFlagStateDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FlagStateDto"];
                };
            };
            /** @description Someone saved a newer version first. */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description If-Match is missing. */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    Flags_kill: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                environment: string;
                flag: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["KillDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FlagStateDto"];
                };
            };
        };
    };
    Schedules_list: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                environment: string;
                flag: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduledChangeDto"][];
                };
            };
        };
    };
    Schedules_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                environment: string;
                flag: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateScheduleDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduledChangeDto"];
                };
            };
        };
    };
    Schedules_cancel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                environment: string;
                flag: string;
                id: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    Webhooks_list: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookDto"][];
                };
            };
        };
    };
    Webhooks_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateWebhookDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedWebhookDto"];
                };
            };
        };
    };
    Webhooks_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateWebhookDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookDto"];
                };
            };
        };
    };
    Webhooks_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    Webhooks_deliveries: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookDeliveryDto"][];
                };
            };
        };
    };
    Webhooks_test: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                project: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookTestDto"];
                };
            };
        };
    };
    Users_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserDto"][];
                };
            };
        };
    };
    Users_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateUserDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserDto"];
                };
            };
        };
    };
    Users_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateUserDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserDto"];
                };
            };
        };
    };
    Health_liveness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The Health Check is successful */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /**
                         * @example {
                         *       "database": {
                         *         "status": "up",
                         *         "responseTime": 12
                         *       }
                         *     }
                         */
                        details?: {
                            [key: string]: {
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                            } & {
                                [key: string]: unknown;
                            };
                        };
                        /** @example {} */
                        error?: {
                            [key: string]: {
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        /**
                         * @example {
                         *       "database": {
                         *         "status": "up",
                         *         "responseTime": 12
                         *       }
                         *     }
                         */
                        info?: {
                            [key: string]: {
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        /**
                         * @example ok
                         * @enum {string}
                         */
                        status?: "ok" | "degraded";
                    };
                };
            };
            /** @description The Health Check is not successful */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /**
                         * @example {
                         *       "database": {
                         *         "status": "up",
                         *         "responseTime": 12
                         *       },
                         *       "redis": {
                         *         "status": "down",
                         *         "message": "Could not connect",
                         *         "responseTime": 3005
                         *       }
                         *     }
                         */
                        details?: {
                            [key: string]: {
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                            } & {
                                [key: string]: unknown;
                            };
                        };
                        /**
                         * @example {
                         *       "redis": {
                         *         "status": "down",
                         *         "message": "Could not connect",
                         *         "responseTime": 3005
                         *       }
                         *     }
                         */
                        error?: {
                            [key: string]: {
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        /**
                         * @example {
                         *       "database": {
                         *         "status": "up",
                         *         "responseTime": 12
                         *       }
                         *     }
                         */
                        info?: {
                            [key: string]: {
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        /**
                         * @example error
                         * @enum {string}
                         */
                        status?: "error" | "shutting_down";
                    };
                };
            };
        };
    };
    Health_readiness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The Health Check is successful */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /**
                         * @example {
                         *       "database": {
                         *         "status": "up",
                         *         "responseTime": 12
                         *       }
                         *     }
                         */
                        details?: {
                            [key: string]: {
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                            } & {
                                [key: string]: unknown;
                            };
                        };
                        /** @example {} */
                        error?: {
                            [key: string]: {
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        /**
                         * @example {
                         *       "database": {
                         *         "status": "up",
                         *         "responseTime": 12
                         *       }
                         *     }
                         */
                        info?: {
                            [key: string]: {
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        /**
                         * @example ok
                         * @enum {string}
                         */
                        status?: "ok" | "degraded";
                    };
                };
            };
            /** @description The Health Check is not successful */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /**
                         * @example {
                         *       "database": {
                         *         "status": "up",
                         *         "responseTime": 12
                         *       },
                         *       "redis": {
                         *         "status": "down",
                         *         "message": "Could not connect",
                         *         "responseTime": 3005
                         *       }
                         *     }
                         */
                        details?: {
                            [key: string]: {
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                            } & {
                                [key: string]: unknown;
                            };
                        };
                        /**
                         * @example {
                         *       "redis": {
                         *         "status": "down",
                         *         "message": "Could not connect",
                         *         "responseTime": 3005
                         *       }
                         *     }
                         */
                        error?: {
                            [key: string]: {
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        /**
                         * @example {
                         *       "database": {
                         *         "status": "up",
                         *         "responseTime": 12
                         *       }
                         *     }
                         */
                        info?: {
                            [key: string]: {
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        /**
                         * @example error
                         * @enum {string}
                         */
                        status?: "error" | "shutting_down";
                    };
                };
            };
        };
    };
    Sdk_evaluate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EvalContextDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkEvaluationDto"];
                };
            };
        };
    };
    Sdk_all: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkFlagsDto"];
                };
            };
        };
    };
    Sdk_stream: {
        parameters: {
            query?: never;
            header?: {
                /** @description Client keys: base64url JSON of { key, attributes }. */
                "X-Flagken-Context"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description An event stream. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
