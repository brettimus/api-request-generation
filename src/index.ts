import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { createHonoMiddleware } from '@fiberplane/hono';
import { users } from './db/schema';
import { makeRequestToolHermes } from './tools';
import { getSystemPrompt } from './prompts';

type Bindings = {
  DATABASE_URL: string;
  // Cloudflare Workers AI binding
  // enabled in wrangler.toml with:
  //
  // > [ai]
  // > binding = "AI"
  AI: Ai;
};

const app = new Hono<{ Bindings: Bindings }>()

app.use(createHonoMiddleware(app));

app.get('/', async (c) => {
  const inferenceResult = await runInference(c.env.AI, "/users/:id")

  // We are not using a stream, but just in case...
  if (inferenceResult instanceof ReadableStream) {
    return c.json({
      message: "Unexpected inference result (stream)",
    }, 500)
  }
  // We are theoretically enforcing a tool call... hopefully this will not happen
  if (inferenceResult.response != null) {
    return c.json({
      message: "Unexpected inference result (text)",
    }, 500)
  }

  const makeRequestCall = inferenceResult.tool_calls?.[0];
  // HACK - Type coercion
  const toolArgs = makeRequestCall?.arguments;

  if (!isObjectGuard(toolArgs)) {
    return c.json({
      message: "Invalid tool args"
    }, 500)
  }

  console.log("toolArgs", JSON.stringify(toolArgs, null, 2));
  return c.json(toolArgs)
})

const isObjectGuard = (value: unknown): value is object => typeof value === 'object' && value !== null;

// app.get('/api/users', async (c) => {
//   const sql = neon(c.env.DATABASE_URL)
//   const db = drizzle(sql);

//   return c.json({
//     users: await db.select().from(users)
//   })
// })

export default app

export async function runInference(client: Ai, userPrompt: string) {
  const result = await client.run(
    // @ts-ignore - This model exists in the Worker types, i don't know why it's causing an error here
    "@hf/nousresearch/hermes-2-pro-mistral-7b",
    {
      tools: [makeRequestToolHermes],
      // Restrict to only using this "make request" tool
      tool_choice: { type: "function", function: { name: makeRequestToolHermes.name } },

      messages: [
        {
          role: "system",
          content: getSystemPrompt("QA"),
        },
        // TODO - File issue on the Cloudflare docs repo
        //        Since this example did not work!
        //
        // {
        //   role: "user",
        //   content: userPrompt,
        // },
      ],
      temperature: 0.12,

      prompt: userPrompt,
    })

  // HACK - Need to coerce this to a AiTextGenerationOutput
  return result as AiTextGenerationOutput;
}
