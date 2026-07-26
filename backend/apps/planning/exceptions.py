from rest_framework.views import exception_handler as drf_exception_handler


def _extract_message(detail):
    if isinstance(detail, dict):
        if list(detail.keys()) == ['detail']:
            return str(detail['detail'])
        return 'One or more fields failed validation.'
    if isinstance(detail, list):
        return ' '.join(str(item) for item in detail)
    return str(detail)


def custom_exception_handler(exc, context):
    """Wraps DRF's default error handling in a consistent {"error": {...}} envelope."""
    response = drf_exception_handler(exc, context)

    if response is None:
        return response

    detail = response.data
    response.data = {
        'error': {
            'status_code': response.status_code,
            'message': _extract_message(detail),
            'details': detail if isinstance(detail, dict) else {'detail': detail},
        }
    }
    return response
