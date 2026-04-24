import type { z } from "zod";
import { useFetcher } from "react-router";

export function defineRouteAction<T extends z.ZodTypeAny>(schema: T) {
    type Input = z.infer<T>;

    async function read(request: Request): Promise<Input> {
        let raw: unknown;

        try {
            raw = await request.json();
        } catch {
            throw new Response("Invalid JSON body", { status: 400 });
        }

        const result = schema.safeParse(raw);

        if (!result.success) {
            throw new Response(
                JSON.stringify({
                    error: "Invalid request body",
                    issues: result.error.issues,
                }),
                {
                    status: 400,
                    headers: {
                        "Content-Type": "application/json",
                    },
                }
            );
        }

        return result.data;
    }

    function useSubmit() {
        const fetcher = useFetcher();

        function submit(input: Input) {
            fetcher.submit(input, {
                method: "post",
                encType: "application/json",
            })
        };

        return {
            submit,
            isSending: fetcher.state !== "idle",
            data: fetcher.data,
        };
    }
    return {
        read,
        useSubmit
    };
}