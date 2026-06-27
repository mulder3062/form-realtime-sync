package com.example.formsync.repository;

import com.example.formsync.model.FormState;

/**
 * 실서비스 전환용 추상화 (명세 §4.5, §8.2).
 * 프로토타입은 {@link InMemoryFormRepository}, 실서비스는 외부 API 구현으로 이것만 교체한다.
 */
public interface FormRepository {

    /** 없으면 null 반환 */
    FormState load(String formId);

    void save(FormState state);
}
