from django import template
from django.template.loader import render_to_string

register = template.Library()


@register.simple_tag
def mapbox_simple(**kwargs):
    style = kwargs.get('style', '/static/map_styles/cartodb-xyz.json')
    links = kwargs.get('links', False)
    maxZoom = kwargs.get('maxZoom', 15)
    query = kwargs.get('query', None)
    icons = kwargs.get('icons', [])
    center = kwargs.get('center', [-0.9307443, 50.7980974])
    json_url = kwargs.get('json_url', None)
    click_url = kwargs.get('click_url', '/Map/${features[0].properties.id}/')

    return render_to_string('mapbox_simple_map_insert.html',
                            {'links': links, 'json_url': json_url, 'query': query, 'icons': icons, 'center': center,
                             'style': style, 'click_url': click_url})


@register.simple_tag
def mapbox_cluster(**kwargs):
    center = kwargs.get('center', [-0.9307443, 50.7980974])
    icons = kwargs.get('icons', [])
    json_url = kwargs.get('json_url', None)
    return render_to_string('mapbox_insert_cluster.html', {'json_url': json_url, 'icons': icons, 'center': center})