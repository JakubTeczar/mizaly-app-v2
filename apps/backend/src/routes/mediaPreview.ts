import { Request, Router } from "express";
import { buildStoryHtml } from "../media/storyTemplate";

const router = Router();

function getBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function withAutoRefresh(html: string, seconds = 2): string {
  return html.replace("<head>", `<head>\n  <meta http-equiv="refresh" content="${seconds}">`);
}

// Dev-only live preview of the story template - open in a browser, edit
// media/templates/story.css, refresh (or wait for the auto-refresh below) to
// see the change. Not mounted under /api and intentionally unauthenticated,
// same as the equivalent tool in the sibling free-server project.
// Example: /preview/story?name=Lukasz+Biegun&subtitle=Trener+personalny&title=Nowy+trening&content=Opis...
router.get("/story", (req, res) => {
  const photo = typeof req.query.photo === "string" ? req.query.photo : "https://picsum.photos/1080/1920";
  const name = typeof req.query.name === "string" ? req.query.name : "Lukasz Biegun";
  const subtitle = typeof req.query.subtitle === "string" ? req.query.subtitle : "Trener personalny";
  const label = typeof req.query.label === "string" ? req.query.label : undefined;
  const title = typeof req.query.title === "string" ? req.query.title : "Nowy post";
  const content =
    typeof req.query.content === "string"
      ? req.query.content
      : "Przykladowy opis posta, ktory pojawi sie w dolnej czesci relacji.";

  const html = buildStoryHtml({
    photoUrl: photo,
    name,
    subtitle,
    label,
    title,
    description: content,
    mode: "http",
    baseUrl: getBaseUrl(req),
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(req.query.raw ? html : withAutoRefresh(html));
});

export default router;
