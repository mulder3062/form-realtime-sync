package com.example.formsync.model;

/**
 * 폼에 현재 접속 중인 참가자 (clientId 단위).
 * presence는 역할(작성자/상담사) 단위가 아니라 clientId 단위로 추적해야
 * 같은 역할이 N명 접속해도 각각을 구분해 표시하고, 한 명이 끊겨도 나머지가 유지된다.
 */
public record Participant(String clientId, String role) {
}
