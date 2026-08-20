export { PdsDurableObject } from "./core/storage";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_health") {
      try {
        const pds = env.PDS.getByName("default");
        const healthy = await pds.health();

        return Response.json(
          { status: healthy ? "ok" : "unavailable" },
          { status: healthy ? 200 : 503 }
        );
      } catch (error) {
        console.error("failed health check", error);
        return Response.json({ status: "unavailable" }, { status: 503 });
      }
    }

    return new Response(null, { status: 204 });
  },
} satisfies ExportedHandler<Env>;
