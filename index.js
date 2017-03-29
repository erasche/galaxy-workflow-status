require("./index.css");
require.context("./", false, /^\.\/.*\.html/);
var globalConfig = require("json!./package.json");

var d3 = require("./bower_components/d3/d3.js");
var margin = {top: -5, right: -5, bottom: -5, left: -5},
    mapped_parameters = [
        'node_color',
        'node_stroke_color',
        'node_text_color',
        'node_border_thickness',
        'link_stroke',
        'link_thickness',
    ],
    height = $(window).height() - margin.top - margin.bottom
    width = $(window).width() - margin.left - margin.right
    default_config = {
        node_color: '#ffffff',
        node_stroke_color: '#333333',
        node_text_color: '#000000',
        node_border_thickness: 1,

        link_stroke: '#000000',
        link_thickness: 1,

        font_family: 'Ubuntu Mono, monospace',
        node_height: 20,
        node_width: 80,
        node_padding: 5,
        zoom: '',
    },
    origGraph = {
        config: default_config
    },
    graph = {
        config: default_config
    },
    container = null,
    simulation = null;

var PBAR_STATES = ['new', 'queued', 'running', 'ok', 'error'];

var progressBarWidth= function(progress, state){
    if(progress === undefined){ return 0; }
    if(state in progress){
        return progress[state];
    } else {
        return 0;
    }
}

var progressBarLeftSum = function(progress, state){
    if(state === 'new'){
        return 0;
    }
    else if(state === 'queued'){
        return progressBarWidth(progress, 'new') + progressBarLeftSum(progress, 'new');
    }
    else if(state === 'running'){
        return progressBarWidth(progress, 'queued') + progressBarLeftSum(progress, 'queued');
    }
    else if(state === 'ok'){
        return progressBarWidth(progress, 'running') + progressBarLeftSum(progress, 'running');
    }
    else if(state === 'error'){
        return progressBarWidth(progress, 'ok') + progressBarLeftSum(progress, 'ok');
    }
    else {
         return 10;
    }
}

var zoom = d3.zoom()
    .scaleExtent([0.2, 10])
    .on("zoom", zoomed)
    .on("end", zoomEnd);

var drag = d3.drag()
    .on("start", dragstarted)
    .on("drag", dragged)
    .on("end", dragended);

var positionOfNode = function(graph, id){
    if(isNaN(parseInt(id))){
        //Sometimes passed object
        id = id.id;
    }
    for(var i in graph.nodes){
        if(parseInt(graph.nodes[i].id) === id){
            return graph.nodes[i];
        }
    }
}

var stepCounts = function(data){
    len = Object.keys(data).length;
    var counts = {};
    for(key in data){
        for(step in data[key]){
            if(!(step in counts)){
                counts[step] = {};
            }
            if(!(data[key][step] in counts[step])){
                counts[step][data[key][step]] = 0;
            }
            counts[step][data[key][step]] += 1;
        }
    }
    for(key in counts){
        for(state in counts[key]){
            counts[key][state] /= len;
        }
    }
    return counts;
}

var processGalaxyWorkflowToGraph = function(ga, progress){
    local_graph = {
        'meta': {
            'name': ga.name,
            'annotation': ga.annotation,
            'uuid': ga.uuid,
        },
        'links': [],
        'nodes': [],
    };

    for(var i in ga.steps){
        var step = ga.steps[i];
        step.x = step.position.left / 1.3;
        step.y = step.position.top / 2;
        if(step.uuid in progress){
            step.progress = progress[step.uuid];
        } else {
            step.progress = progress[step.id];
        }
        local_graph.nodes.push(step);

        for(var j in ga.steps[i].input_connections){
            if(Array.isArray(ga.steps[i].input_connections[j])){
                for(var k in ga.steps[i].input_connections[j]){
                    var source = parseInt(i);
                    var target = ga.steps[i].input_connections[j][k].id;

                    if(target && source){
                        local_graph.links.push({
                            source: {
                                id: source,
                                x: step.position.left / 4,
                                y: step.position.top / 4,
                            },
                            target: target,
                        })
                    }
                }
            }else{
                var source = parseInt(i);
                var target = ga.steps[i].input_connections[j].id;

                if(typeof target !== 'undefined' && typeof source !== 'undefined'){
                    local_graph.links.push({
                        source: source,
                        target: target,
                    })
                }
            }
        }
    }
    return local_graph;
}


function hexToRgb(hex) {
    // http://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb/11508164#11508164
    var bigint = parseInt(hex.substring(1), 16);
    var r = (bigint >> 16) & 255;
    var g = (bigint >> 8) & 255;
    var b = bigint & 255;
    return [r, g, b]
}

function clone(obj){
    return JSON.parse(JSON.stringify(obj));
}

function restore(){
    graph = JSON.parse(sessionStorage.getItem('graph'));
    origGraph = JSON.parse(sessionStorage.getItem('origGraph'));
    restoreParamsFromGraph(graph);
}

function restoreParamsFromGraph(g){
    for(var idx in mapped_parameters){
        $("#" + mapped_parameters[idx]).val(g.config[mapped_parameters[idx]])
    }
}

function draw(){
    $("svg").empty();

    var svg = d3.select("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", "translate(" + margin.left + "," + margin.right + ")")
        .call(zoom);

    var defs = d3.select('svg')
        .append('defs');

    defs.append('marker')
        .attr('orient', 'auto')
        .attr('refX', '0.0')
        .attr('refY', '0.0')
        .attr('id', 'Arrow')
        .attr('style', 'overflow:visible')
        .append('path')
        .attr('style', "fill-rule:evenodd;stroke-linejoin:round;fill:" + graph.config.link_stroke + ";fill-opacity:1")
        .attr('d',"M 8.7185878,4.0337352 L -2.2072895,0.016013256 L 8.7185884,-4.0017078 C 6.9730900,-1.6296469 6.9831476,1.6157441 8.7185878,4.0337352 z ")
        .attr('transform', 'scale(0.6)')
        ;

    var grad_dec = defs.append('linearGradient')
        .attr('id', 'grad_dec');
    grad_dec.append('stop')
        .attr('style', 'stop-color:' + graph.config.link_stroke + ';stop-opacity:1')
        .attr('offset', '0.3')
    grad_dec.append('stop')
        .attr('style', 'stop-color:' + graph.config.link_stroke + ';stop-opacity:1')
        .attr('offset', '0.5')

    var grad_inc = defs.append('linearGradient')
        .attr('id', 'grad_inc');
    grad_inc.append('stop')
        .attr('style', 'stop-color:' + graph.config.link_stroke + ';stop-opacity:1')
        .attr('offset', '0.5')
    grad_inc.append('stop')
        .attr('style', 'stop-color:' + graph.config.link_stroke + ';stop-opacity:1')
        .attr('offset', '0.7')
    //<linearGradient
       //inkscape:collect="always"
       //id="linearGradient4371">
      //<stop
         //style="stop-color:#000000;stop-opacity:1;"
         //offset="0"
         //id="stop4373" />
      //<stop
         //style="stop-color:#000000;stop-opacity:0;"
         //offset="1"
         //id="stop4375" />
    //</linearGradient>


    var rect = svg.append("rect")
        .attr("width", width)
        .attr("height", height)
        .style("fill", "none")
        .style("pointer-events", "all");

    container = svg.append("g");
    if(graph.config.zoom){
        //container.attr("transform", graph.config.zoom);
    }

    var cachedData = {};
    simulation = d3.forceSimulation();

    var link = container.append("g")
        .attr("class", "links")
        .selectAll("line")
        .data(graph.links)
        .enter()
        .append("path")
        .attr("stroke", "black")
        .attr("fill", "none")
        .attr("marker-start", "url(#Arrow)")
        ;

    var node_group = container.append("g")
        .attr("class", "nodes")
        .selectAll("rect")
        .data(graph.nodes)
        .enter()
        .append("g").call(
            d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended)
        )
        ;

    // states               = [new, queued, running, ok, error]
    var progressBarsNew     = node_group.append("rect").attr("height", 30).attr('class', 'pbar_new');
    var progressBarsQueued  = node_group.append("rect").attr("height", 30).attr('class', 'pbar_queued');
    var progressBarsRunning = node_group.append("rect").attr("height", 30).attr('class', 'pbar_running');
    var progressBarsOk      = node_group.append("rect").attr("height", 30).attr('class', 'pbar_ok');
    var progressBarsError   = node_group.append("rect").attr("height", 30).attr('class', 'pbar_error');


    var node = node_group
        .append("rect")
        .attr("height", graph.config.node_height + 2 * graph.config.node_padding)
        .attr("width", graph.config.node_width + 2 * graph.config.node_padding)
        ;

    var labels = node_group
        .append("text")
        .attr("class", "labels")
        .text(function(d){ return d.name; })
        ;

    if(true){
        //dynamic
        simulation
            .nodes(graph.nodes)
            .on("tick", ticked)
            ;
    } else {
        //static plkot
        ticked();
        ticked();
        ticked();
    }

    function ticked() {
        link
            .attr("d", function(d){
                target = positionOfNode(graph, d.target)
                source = positionOfNode(graph, d.source)
                if(cachedData[d.target]){
                    tx = target.x + cachedData[d.target].width;
                } else {
                    tx = 0;
                }
                ty = target.y + graph.config.node_height / 2;
                if(source && !source.x){
                    sx = 0;
                }else{
                    sx = source.x;
                }
                sy = source.y + graph.config.node_height / 2;
                if(!tx || !ty || !sx || !sy){
                    return 'M100,100'
                }

                cp1x = undefined;
                cp2x = undefined;

                if(sx > tx + 30){
                    cp1x = cp2x = ((sx + tx) / 2);
                }else{
                    diff = Math.min((tx - sx + 45), 30);
                    cp1x = (sx - diff)
                    cp2x = (tx + diff)
                }

                data = 'M' + sx + ',' + sy + 'C' + cp1x +',' + sy + ' ' + cp2x +',' + ty + ' ' + tx +',' + ty
                return data;
            })
            //.attr("stroke", graph.config.link_stroke)
            .attr("stroke", function(d){
                target = positionOfNode(graph, d.target)
                source = positionOfNode(graph, d.source)

                if((cachedData[source.id]) && (cachedData[target.id])){
                    if(cachedData[source.id].focus && cachedData[target.id].focus){
                        return graph.config.link_stroke;
                    } else if (cachedData[source.id].focus && !cachedData[target.id].focus){
                        if(cachedData[source.id].x < cachedData[target.id].x + cachedData[target.id].width + 15){
                            return 'url(#grad_dec)'
                        } else {
                            return 'url(#grad_inc)'
                        }
                    } else if (!cachedData[source.id].focus && cachedData[target.id].focus){
                        if(cachedData[source.id].x < cachedData[target.id].x + cachedData[target.id].width + 15){
                            return 'url(#grad_inc)'
                        } else {
                            return 'url(#grad_dec)'
                        }
                    } else {
                        var rgb  = hexToRgb(graph.config.link_stroke)
                        return 'rgb(' + rgb[0]  + ','  + rgb[1]  + ','  + rgb[2]  + ')';
                    }
                }
                return 'black';
            })
            .attr("stroke-width", graph.config.link_thickness)
            ;

        node
            .attr("fill", 'none')
            .attr("stroke", graph.config.node_stroke_color)
            .attr("stroke-width", graph.config.node_border_thickness)
            .attr("x", function(d) { return d.x; })
            .attr("y", function(d) { return d.y; })
            .attr("opacity", "1")
            ;

        progressBarsNew
            .attr("x", function(d) {
                if(cachedData[d.id] && cachedData[d.id].width){
                    return d.x + cachedData[d.id].width *  progressBarLeftSum(d.progress, 'new');
                }
                return d.x })
            .attr('width', function(d){
                if(cachedData[d.id] && cachedData[d.id].width){
                    return cachedData[d.id].width * progressBarWidth(d.progress, 'new')
                }
                return 0;
            })
            .attr("y", function(d) { return d.y;  })
            ;

        progressBarsQueued
            .attr("x", function(d) {
                if(cachedData[d.id] && cachedData[d.id].width){
                    return d.x + cachedData[d.id].width *  progressBarLeftSum(d.progress, 'queued');
                }
                return d.x })
            .attr('width', function(d){
                if(cachedData[d.id] && cachedData[d.id].width){
                    return cachedData[d.id].width * progressBarWidth(d.progress, 'queued')
                }
                return 0;
            })
            .attr("y", function(d) { return d.y;  })
            ;

        progressBarsRunning
            .attr("x", function(d) {
                if(cachedData[d.id] && cachedData[d.id].width){
                    return d.x + cachedData[d.id].width *  progressBarLeftSum(d.progress, 'running');
                }
                return d.x })
            .attr('width', function(d){
                if(cachedData[d.id] && cachedData[d.id].width){
                    return cachedData[d.id].width * progressBarWidth(d.progress, 'running')
                }
                return 0;
            })
            .attr("y", function(d) { return d.y;  })
            ;

        progressBarsOk
            .attr("x", function(d) {
                if(cachedData[d.id] && cachedData[d.id].width){
                    return d.x + cachedData[d.id].width *  progressBarLeftSum(d.progress, 'ok');
                }
                return d.x })
            .attr('width', function(d){
                if(cachedData[d.id] && cachedData[d.id].width){
                    return cachedData[d.id].width * progressBarWidth(d.progress, 'ok')
                }
                return 0;
            })
            .attr("y", function(d) { return d.y;  })
            ;

        progressBarsError
            .attr("x", function(d) {
                if(cachedData[d.id] && cachedData[d.id].width){
                    return d.x + cachedData[d.id].width *  progressBarLeftSum(d.progress, 'error');
                }
                return d.x })
            .attr('width', function(d){
                if(cachedData[d.id] && cachedData[d.id].width){
                    return cachedData[d.id].width * progressBarWidth(d.progress, 'error')
                }
                return 0;
            })
            .attr("y", function(d) { return d.y;  })
            ;

        labels
            .attr("stroke", function(d){
                cachedData[d.id] = {
                    width: this.getComputedTextLength() + 2 * graph.config.node_padding,
                    focus: (cachedData[d.id]) ? cachedData[d.id].focus : d.focus,
                    x: d.x,
                    //y: d.y,
                }
                d3.select(this.parentNode.children[5]).attr('width', cachedData[d.id].width);
            })
            .attr("font-family", graph.config.font_family)
            .attr("fill", graph.config.node_text_color)
            .attr("opacity", "1")
            .attr("x", function(d) { return d.x + graph.config.node_padding; })
            .attr("y", function(d) { return d.y + 15 + graph.config.node_padding; });//TODO
    }
};

function zoomed(x) {
    tx = d3.event.transform;
    txf = "translate(" + tx.x + " " + tx.y + ") scale(" + tx.k + ")";
    container.attr("transform", txf);
}

function zoomEnd(x) {
    tx = d3.event.transform;
    txf = "translate(" + tx.x + " " + tx.y + ") scale(" + tx.k + ")";
    graph.config.zoom = txf;
}

function dragstarted(d) {
    if (!d3.event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x; d.fy = d.y;
    d3.event.sourceEvent.stopPropagation();
}

function dragged(d) {
    d.fx = d3.event.x;
    d.fy = d3.event.y;
}

function dragended(d) {
    d.fx = null;
    d.fy = null;
}

function load(){
    console.log("Loading")
    d3.json("out.ga", function(error, loadedGraph){
        if (error){
            Materialize.toast(error, 4000)
            throw error;
        }
        d3.json("data.json", function(error, loadedData){
            if (error){
                Materialize.toast(error, 4000)
                throw error;
            }

            progress = stepCounts(loadedData);
            graph = processGalaxyWorkflowToGraph(loadedGraph, progress);
            graph.config = default_config;
            origGraph = clone(graph);
            draw();
        })
    })
}

load();

$(window).on('load resize', function(){
    height = $(window).height() - margin.top - margin.bottom
    width = $(window).width() - margin.left - margin.right

    d3.select("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .select("rect")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
});
