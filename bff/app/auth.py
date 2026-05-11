from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import get_user_by_id
from .security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token.")
    sub = payload.get("sub")
    try:
        user_id = int(sub)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload.")
    user = get_user_by_id(user_id)
    if user is None or not user.get("is_active", False):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is inactive.")
    return user


def require_positions_access(user=Depends(get_current_user)):
    if not user["permissions"]["can_view_positions"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to positions.")
    return user


def require_books_access(user=Depends(get_current_user)):
    if not user["permissions"]["can_view_books"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to books.")
    return user


def require_access_management(user=Depends(get_current_user)):
    if not user["permissions"]["can_manage_access"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to user permissions.")
    return user
