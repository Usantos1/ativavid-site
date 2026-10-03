import { onRequestGet as __download___plataforma___js_onRequestGet } from "C:\\Users\\Uander\\Documents\\GitHub\\ativavid-site\\functions\\download\\[[plataforma]].js"

export const routes = [
    {
      routePath: "/download/:plataforma*",
      mountPath: "/download",
      method: "GET",
      middlewares: [],
      modules: [__download___plataforma___js_onRequestGet],
    },
  ]