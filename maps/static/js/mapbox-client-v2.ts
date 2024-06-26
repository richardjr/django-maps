import {Map, MapGeoJSONFeature, NavigationControl, Source} from 'maplibre-gl';
// @ts-ignore
import MapboxDraw from '@mapbox/mapbox-gl-draw';
// @ts-ignore
import * as turf from '@turf/turf';


// Declair our global map variable
declare global {
    interface Window {
        map: DjangoMapboxClient;
    }
}

// Define the structure of your JSON objects as GeoJSON

// Feature
interface Feature {
    type: string;
    geometry: {
        type: string;
        coordinates: number[];
    };
    properties?: {
        [key: string]: any;
    };
}

// GeoJSON

type GeoJSON = {
    type: string;
    features: Feature[];
};

// Map of GeoJSON objects we use to keep layers in sync with the map
interface GeoJSONMap {
    [key: string]: GeoJSON; // Define the structure of your JSON objects as GeoJSON
}

// Icons
interface Icon {
    name: string;
    url: string;
}

// Queue Operation
interface QueueOperation {
    type: "add_layer" | "remove_layer" | "add_geojson" | "clear_layer" | "set_visibility" | "add_event" | "resize" | "line_draw" | "set_center" | "delete_feature" | "move_feature";
    layer_name?: string; // This makes layer_name optional
    data?: GeoJSON;
    url?: string;
    values?: any;
    hook?: Function;
    toggle?: boolean;
}

// Client Options used to initialize the map
interface ClientOptions {
    minZoom: number;
    maxZoom: number;
    zoom: number;
    padding: number;
    center: [number, number];
    style: string;
    controls: boolean;
    debug: boolean;
    icons: Icon[];
    json_url: string;
    fit: boolean;
}

// Event Options used to add events to the map
interface eventOptions {
    hook?: Function;
    layer?: string;
    clear?: boolean;
    add_point?: boolean;
    hook_actual?: Function;
}

const defaultLayers = ["data"];

// Mapbox Client
class DjangoMapboxClient {
    map: Map;
    queue: QueueOperation[] = [];
    loaded: boolean = false;
    currentLocation: [number, number] = null;
    debug: boolean = false;
    canvas: HTMLElement;

    options: ClientOptions;

    geojson: GeoJSONMap = {};
    events: eventOptions[] = [];

    // Draw line mode
    draw_point_mode= "add";
    draw_actual_points: any[] =[];

    moving_point: any=null;


    constructor() {

    }

    init(options: ClientOptions) {
        this.options = options;
        this.map = new Map({
            container: 'map',
            style: this.options.style,
            center: this.options.center,
            zoom: this.options.zoom,
            minZoom: this.options.minZoom,
            maxZoom: this.options.maxZoom
        });

        // Setup default layers geojson
        for(let layer in defaultLayers) {
            this.geojson[defaultLayers[layer]] = {"type":"FeatureCollection","features":[]};
        }

        if (this.options.controls === true) {
            this.map.addControl(new NavigationControl());
        }

        this.canvas = this.map.getCanvasContainer();

        if (options.debug && options.debug === true) {
            console.log('*********************** MAP DEBUG ***********************')
            console.log('Mapbox Client: ', options);
            this.map.showCollisionBoxes = true;
            this.map.showTileBoundaries = true;
            this.map.on('click', () => {
                // Print the current map center and zoom
                console.log('Center:', this.map.getCenter());
                console.log('Zoom:', this.map.getZoom());
            });
        }

        let self = this;

        this.map.on('load', function () {
            console.log('Map Loaded');
            self.loaded = true;
            self.loadIcons(self.options.icons);
            self.enableLocation();
            self.processQueue();
            self.reload_data();
        });

        const draw = new MapboxDraw();
        this.map.addControl(
            draw,
        );

    }

    loadIcons(icons: Icon[]) {
        let self = this;
        icons.forEach((icon) => {
            // Make a random uuid to use as the image name
            const uuid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            console.log('Loading Icon:', icon);
            self.map.loadImage(icon.url+"?cacheblock="+uuid).then(response => {
                console.log(response);

                // Add the image to the map
                self.map.addImage(icon.name, response.data);
            });
        });
    }

    enableLocation() {
    }

    reload_data() {
        if (this.options.json_url !== 'None') {
            fetch(this.options.json_url)
                .then(response => response.json())
                .then(data => {
                    this.addGeojson(data, 'data', this.options.fit);
                })
                .catch(error => console.error(error));
        }
    }

    addGeojson(data: GeoJSON, layer_name: string = 'data', fit: boolean = false, values?:{}) {
        this.addQueueOperation({type: 'add_geojson', data: data, layer_name: layer_name, toggle: fit, values:values});
    }

    addQueueOperation(operation: QueueOperation) {
        this.queue.push(operation);
        this.processQueue();
    }

    /**
     * Add ids to the geojson data
     *
     * We need unique ids for each feature
     * @param data
     */
    _addIdsToGeojson(data: GeoJSON) {
        for (let i in data.features) {
            if (!data.features[i].properties.id) {
                data.features[i].properties.id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            }
        }
        return data;
    }

    /**
     * Process the queue of operations
     *
     */
    processQueue(): void {
        let source: Source;
        let self=this;

        if (this.loaded === true && this.queue.length > 0) {
            let operation = this.queue.shift();
            console.log(`Processing Queue ${operation.type}`);
            if(operation.data)
                console.log(operation.data);

            switch (operation.type) {
                case 'line_draw':
                    this._LineDrawMode(operation);
                    break;
                case 'set_center':
                    this.map.setCenter(operation.values);
                    break;
                case 'delete_feature':
                    source=this.map.getSource(operation.layer_name);
                    if(this.geojson[operation.layer_name]) {
                        let data = this.geojson[operation.layer_name]
                        let features = data.features;
                        for (let i in features) {
                            if (features[i].properties && features[i].properties.id && features[i].properties.id === operation.values.id) {
                                features.splice(Number(i), 1);
                                break;
                            }
                        }
                        source.setData(data);
                    }
                    break;
                case 'move_feature':
                    source=this.map.getSource(operation.layer_name);
                    if(this.geojson[operation.layer_name]) {
                        let data = this.geojson[operation.layer_name]
                        let features = data.features;
                        for (let i in features) {
                            if (features[i].properties && features[i].properties.id && features[i].properties.id === operation.values.id) {
                                features[i].geometry.coordinates = operation.values.lonLat;
                                break;
                            }
                        }
                        source.setData(data);
                    }
                    break;
                case 'add_geojson':
                    source=this.map.getSource(operation.layer_name);
                    // Add ids to the geojson
                    operation.data = this._addIdsToGeojson(operation.data);
                    if(operation.values&&operation.values['merge']===true&&this.geojson[operation.layer_name]) {
                        // Merge the data
                        let new_data = operation.data;
                        let old_data = this.geojson[operation.layer_name]
                        for(let i in new_data.features) {
                            old_data.features.push(new_data.features[i]);
                        }
                        // copy the old data
                        let copyData=JSON.parse(JSON.stringify(old_data));
                        source.setData(old_data);
                        this.geojson[operation.layer_name] = copyData;
                    } else {
                        let copyData=JSON.parse(JSON.stringify(operation.data));
                        source.setData(operation.data);
                        this.geojson[operation.layer_name] = copyData;
                    }
                    if (this.geojson[operation.layer_name].features.length > 0) {
                        if(operation.toggle === true) {
                            const bbox = turf.bbox(this.geojson[operation.layer_name]);
                            this.map.fitBounds(bbox, {padding: this.options.padding, maxZoom: this.options.maxZoom});
                        }
                    }
                    console.log(this.geojson[operation.layer_name])
                    break;
                case 'clear_layer':
                    this.map.clearLayer(operation.layer_name);
                    break;
                case 'add_event':
                    const callback = (event: Event) => {
                        // See if there is a feature(s) here:
                        let features: MapGeoJSONFeature[] = [];
                        let actual_features=[];

                        if (operation.layer_name) {
                            // Filters do not seem to work correctly for line strings because reasons
                            let layers=operation.layer_name.split(',');
                            features = self.map.queryRenderedFeatures(event.point, {layers: layers});
                            // we need to get the actual feature from the geojson not these ones as they are in a crazy state
                            for(let i in features) {
                                let feature = self.getFeature(layers[0],features[i].properties.id);
                                if(feature) {
                                    actual_features.push(feature);
                                }
                            }
                        }
                        // @ts-ignore
                        operation.hook([event.lngLat.lng, event.lngLat.lat], event, actual_features);
                    }

                    if (operation.toggle === true) {
                        self.clearAllEvents();
                    }

                    // Make an event object
                    let event: eventOptions = {hook: operation.hook, layer: operation.layer_name, clear: operation.toggle};
                    event.hook_actual = callback;
                    this.map.on('click', callback);
                    this.events.push(event);
                    break;
                case 'resize':
                    this.map.resize();
                    break;
                default:
                    console.log('Unknown Operation', operation);
                    break;
            }
            this.processQueue()
        }
    }

    // private methods

    _fuzzyMatch(point1: number,point2: number,precision?: number) {
        precision=precision||0.0001;
        //console.log(`points: ${point1}:${point2} diff: ${point1-point2} - precision: ${precision}`);
        if(point1===point2&&point1===point2)
            return true;
        if(point1-precision<=point2&&point1+precision>=point2&&point1-precision<=point2&&point1+precision>=point2)
            return true;
        return false;
    }


    _findMidpoint(pointA: number[], pointB: number[]): number[]    {
        return [(pointA[0] + pointB[0]) / 2, (pointA[1] + pointB[1]) / 2];
    }

    _drawLine() {
        let line = {
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: this.draw_actual_points
            }
        };
        // Draw the line on the map
        this.geojson["draw-end-points"]={"type":"FeatureCollection","features":[]};
        this.geojson["draw-mid-points"]={"type":"FeatureCollection","features":[]};

        // Make the actual points geojson
        for(let i in this.draw_actual_points) {
            this.geojson["draw-end-points"].features.push({
                "type": "Feature",
                "geometry": {"coordinates": this.draw_actual_points[i], "type": "Point"},
                "properties": {"actual_index": i }
            });
        }

        // Make the mid points geojson
        for(let i=0;i<this.draw_actual_points.length-1;i++) {
            let mid_point=this._findMidpoint(this.draw_actual_points[i],this.draw_actual_points[i+1]);
            this.geojson["draw-mid-points"].features.push({
                "type": "Feature",
                "geometry": {"coordinates": [mid_point[0],mid_point[1]], "type": "Point"},
                "properties": { "actual_index": i }
            });
        }

        this.map.getSource("draw-mid-points").setData(this.geojson["draw-mid-points"]);
        this.map.getSource("draw-end-points").setData(this.geojson["draw-end-points"]);
        this.map.getSource("draw-vertex").setData(line);

    }

    _LineDrawMode(operation?: QueueOperation) {


        let self = this;
        this.moving_point=null;

        this.map.getSource("draw-end-points").setData({"type":"FeatureCollection","features":[]});
        this.geojson["draw-end-points"] = {"type":"FeatureCollection","features":[]};

        function onMove(e: Event) {
            const coords = e.lngLat;
            self.draw_actual_points[self.moving_point]=[coords.lng, coords.lat];
            self._drawLine();
            self.canvas.style.cursor = 'grabbing';
        }

        function onUp(e: Event) {
            self.canvas.style.cursor = '';
            self.map.off('mousemove', onMove);
            self.map.off('touchmove', onMove);
        }

        this.map.on('mousedown', 'draw-end-points', (e) => {
            e.preventDefault();
            if(e.originalEvent.which===1) {
                // left click
                self.moving_point = e.features[0].properties.actual_index;
                self.canvas.style.cursor = 'grab';
                self.map.on('mousemove', onMove);
                self.map.once('mouseup', onUp);
            }
            if(e.originalEvent.which===3) {
                // right click
                self.draw_actual_points.splice(e.features[0].properties.actual_index,1);
                self._drawLine();
            }
        });

        this.map.on('mousedown', 'draw-mid-points', (e) => {
            e.preventDefault();
            if(e.originalEvent.which===1) {
                // add a new point at the midpoint in the array
                self.draw_actual_points.splice(e.features[0].properties.actual_index + 1, 0, [e.lngLat.lng, e.lngLat.lat]);
                self._drawLine();
                self.moving_point = e.features[0].properties.actual_index + 1;
                self.canvas.style.cursor = 'grab';
                self.map.on('mousemove', onMove);
                self.map.once('mouseup', onUp);
            }
        });

        // json contains a line string we need to convert to points in draw_actual_points
        if(operation.data&&operation.data.features&&operation.data.features.length>0&&operation.data.features[0].geometry&&operation.data.features[0].geometry.coordinates&&operation.data.features[0].geometry.coordinates.length>0) {
            console.log(operation.data)
            this.draw_actual_points=operation.data.features[0].geometry.coordinates;
            // Create a line between all the points
            let line = {
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: this.draw_actual_points
                }
            };
            // Draw the line on the map
            self.map.getSource("draw-vertex").setData(line);
            self._drawLine();
        }


        function addPoint(point: any[],e: Event) {
            const features = self.map.queryRenderedFeatures(e.point, {layers: ['draw-end-points']});

            if(self.draw_point_mode==="add") {
                if (features.length > 0) {
                    // This is a move then handled else where
                } else {
                    self.draw_actual_points.push(point);
                    // Create a line between all the points
                    self._drawLine();
                }
            } else {
                // Delete mode
                // Find any points within 10 pixels of the click
                if (features.length > 0) {
                    // Delete the point
                    // find the point in draw_actual_points using the coordinates
                    for(let i in self.draw_actual_points) {
                        // fuzzy match of coordinates by 0.0001

                        if(self._fuzzyMatch(self.draw_actual_points[i][0],features[0].geometry.coordinates[0])&&self._fuzzyMatch(self.draw_actual_points[i][1],features[0].geometry.coordinates[1])) {
                            self.draw_actual_points.splice(i,1);
                            break;
                        }
                    }
                    self._drawLine();
                }
            }
        }

        window.map.clickEvent({"hook":addPoint,"clear":true});
    }

    // Public Methods


    /**
     * Undo the last point drawn
     * @constructor
     */
    LineDrawUndo() {
        if(this.draw_actual_points.length>0)
            this.draw_actual_points.pop();
        this._drawLine();
    }


    /**
     * Line Draw Mode enable
     * @param layer_name - the layer name to draw on
     * @param toggle - enable or disable
     * @constructor
     */
    LineDrawMode(layer_name: string, toggle: boolean = true, features?: GeoJSON) {
        this.addQueueOperation({type: 'line_draw', layer_name: layer_name, toggle: toggle, data: features});
    }

    /**
     * Set the visibility of a layer
     * @param layer_name
     * @param visibility
     */
    setLayerVisibility(layer_name: string, visibility: string) {
        this.addQueueOperation({type: 'set_visibility', layer_name: layer_name, values: {visibility: visibility}});
    }

    /**
     * Set the center of the map
     * @param center
     */
    setCenter(center: [number, number]) {
        this.addQueueOperation({type: 'set_center', values: center});
    }

    /**
     * Delete a feature from a layer using the feature id
     * @param layer_name
     * @param feature_id
     */
    deleteFeature(layer_name: string, feature_id: string) {
        this.addQueueOperation({type: 'delete_feature', layer_name: layer_name, values: {id: feature_id}});
    }

    moveFeaturePoint(layer_name: string, feature_id: string, lonLat: any[]) {
        this.addQueueOperation({type: 'move_feature', layer_name: layer_name, values: {id: feature_id, lonLat: lonLat}});
    }

    /**
     * Get a layer as a geojson object
     * @param layer_name
     * @return {GeoJSON}
     */
    getGeojsonLayer(layer_name: string) {
        return this.geojson[layer_name];
    }

    getFeature(layer_name: string, feature_id: string) {
        let features = this.geojson[layer_name].features;
        console.log(features);
        for (let i in features) {
            if (features[i].properties && features[i].properties.id && features[i].properties.id === feature_id) {
                return features[i];
            }
        }
        return null;
    }

    /**
     * Merge two geojson objects
     * @param data1
     * @param data2
     * @return {GeoJSON}
     */
    mergeGeojson(data1: GeoJSON, data2: GeoJSON): GeoJSON {
        let features = data1.features.concat(data2.features);
        return {
            type: "FeatureCollection",
            features: features
        };
    }

    /**
     * Get the center of the map
     * @return {number[]}
     */
    getCenter() : number[] {
        // get center of the map
        const center = this.map.getCenter();
        // return the center as an array
        return [center.lng, center.lat];
    }


    /**
     * Get the drawn line string TODO this needs to support multiple lines
     */
    getDrawnLineString(): GeoJSON {
        let data: GeoJSON= {"type":"FeatureCollection","features":[{
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: this.draw_actual_points
                }
            }]};
        return data;
    }

    /**
     * Finalise the line draw and add it to the map
     * @param layer
     * @param properties
     */
    finaliseLineDraw(layer: string = 'data', properties: {} = {},mode: string = 'save'): void {
        this.clearAllEvents();
        if(mode==="save") {
            let geojson: GeoJSON = this.getDrawnLineString();
            geojson.features[0].properties = properties;
            // Check we have more than 2 points
            if (geojson.features[0].geometry.coordinates.length < 2) {
                return;
            }
            geojson = this._addIdsToGeojson(geojson);
            this.addGeojson(geojson, layer, false, {merge: true});
        }
        this.draw_actual_points=[];
        this.map.getSource("draw-vertex").setData({"type":"FeatureCollection","features":[]});
        this.map.getSource("draw-mid-points").setData({"type":"FeatureCollection","features":[]});
        this.map.getSource("draw-end-points").setData({"type":"FeatureCollection","features":[]});
        this.geojson["draw-end-points"] = {"type":"FeatureCollection","features":[]};
        this.geojson["draw-mid-points"] = {"type":"FeatureCollection","features":[]};
        this.geojson["draw-vertex"] = {"type":"FeatureCollection","features":[]};
    }

    /**
     * Clear all events from the map
     * @return {void}
     */
    clearAllEvents(): void {
        for (let i in this.events) {
            // @ts-ignore IS this working???
            this.map.off('click', this.events[i].hook_actual);
        }
        this.events = [];
    }

    /**
     * Add a click event to the map
     * @param eventOption
     */
    clickEvent(eventOption: eventOptions): void {
        this.addQueueOperation({
            type: 'add_event',
            layer_name: eventOption.layer,
            hook: eventOption.hook,
            toggle: eventOption.clear
        });
    }

    /**
     * resize the map
     * @return {void}
     */
    resize(): void {
        this.addQueueOperation({type: 'resize'});
    }

    /**
     * Set the style of the map
     * @param style
     */
    setStyle(style: string) {
        this.map.setStyle(style);
        // Reload all the geojson data
        for(let layer in this.geojson) {
            this.map.getSource(layer).setData(this.geojson[layer]);
        }
    }
}

export default {DjangoMapboxClient};
let mapClient = new DjangoMapboxClient();

window.map = mapClient;
// DomContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    // Get the map element and start the mapbox client
    let mapElement = document.getElementById('map');
    // get the json in data-params
    let params_string: string = mapElement.getAttribute('data-params');
    // reformat to json by replacing single quotes with double quotes
    params_string = params_string.replace(/'/g, '"');

    let params: ClientOptions = JSON.parse(params_string);
    mapClient.init(params);
});
