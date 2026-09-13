---
url: {{ url }}
fetched_at: {{ fetched_at }}
job_key: {{ job_key }}
{% if portal %}portal: {{ portal }}
{% endif %}{% if title %}title: {{ title }}
{% endif %}---

{% if title %}# {{ title }}{% else %}# Job posting{% endif %}

{{ content }}
