package com.example.formsync.model;

import java.util.List;

/**
 * 접속(신규·재연결) 시 1회 내려주는 스냅샷 (명세 §4.2).
 * 폼 상태(SoT)에 더해 현재 접속 중인 참가자 목록을 함께 전달해
 * 신규 접속자가 "이미 들어와 있는 사람들"을 즉시 인지할 수 있게 한다.
 * (자기 자신은 아직 USER_JOIN 전이라 목록에 없으며, 클라이언트가 로컬에서 합친다.)
 */
public record FormSnapshot(FormState state, List<Participant> participants) {
}
