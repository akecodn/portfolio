from fastapi import APIRouter, Depends, HTTPException, status

from ..auth import get_current_user
from ..db import get_user_by_username
from ..models import LoginIn, LoginOut, UserOut
from ..security import create_access_token, verify_password

router = APIRouter()


@router.post("/auth/login", response_model=LoginOut)
def login(payload: LoginIn):
    username = payload.username.strip()
    user = get_user_by_username(username)
    if user is None or not user.get("is_active", False):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password.")
    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password.")
    token = create_access_token(user["id"], user["username"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": UserOut.model_validate(user),
    }


@router.get("/auth/me", response_model=UserOut)
def me(user=Depends(get_current_user)):
    return user
