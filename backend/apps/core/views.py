from rest_framework.decorators import api_view  # type: ignore
from rest_framework.response import Response  # type: ignore


@api_view(['GET'])
def health_check(request):
    """Health check endpoint — returns service status."""
    return Response({'status': 'ok'})
