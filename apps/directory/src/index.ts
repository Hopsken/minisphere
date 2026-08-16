export default {
  fetch(): Response {
    return new Response(null, { status: 204 });
  },
} satisfies ExportedHandler<Env>;
