import { render } from "solid-js/web";
import "maplibre-gl/dist/maplibre-gl.css";
import "uplot/dist/uPlot.min.css";
import "./styles.css";
import App from "./App";

render(() => <App />, document.getElementById("root")!);
